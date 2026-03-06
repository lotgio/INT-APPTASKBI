// Supabase Edge Function per generare feed iCalendar
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import ical from "https://esm.sh/ical-generator@4.1.0";

serve(async (req) => {
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Estrai resourceId dall'URL
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const resourceId = pathParts[pathParts.length - 1];

    if (!resourceId || resourceId === "calendar") {
      return new Response(
        JSON.stringify({ error: "Missing resourceId in path" }),
        { 
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Crea client Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Recupera todos
    const { data: todos, error: todosError } = await supabase
      .from("todos")
      .select("*")
      .eq("resourceid", resourceId)
      .order("duedate", { ascending: true });

    if (todosError) throw todosError;

    // Recupera tasks
    const { data: tasks, error: tasksError } = await supabase
      .from("tasks")
      .select("*")
      .eq("assigneeid", resourceId)
      .order("startdate", { ascending: true });

    if (tasksError) throw tasksError;

    // Recupera info membro
    const { data: member } = await supabase
      .from("members")
      .select("name")
      .eq("id", resourceId)
      .single();

    const memberName = member?.name || "Risorsa";

    // Crea calendario iCal
    const calendar = ical({
      name: `Task ${memberName}`,
      description: `Pianificazione task per ${memberName}`,
      timezone: "Europe/Rome",
      ttl: 900,
      prodId: {
        company: "AppTaskBI",
        product: "Task Calendar",
        language: "IT",
      },
    });

    // Aggiungi eventi per ogni todo
    (todos || []).forEach((todo: any) => {
      let start = todo.duedate
        ? new Date(todo.duedate)
        : todo.createdat
        ? new Date(todo.createdat)
        : new Date();

      // Imposta orario default a 09:00 se è solo data
      if (todo.duedate && !String(todo.duedate).includes("T")) {
        start.setHours(9, 0, 0, 0);
      }

      let end = new Date(start);
      end.setHours(start.getHours() + 1);

      const description = [
        todo.description || "",
        todo.commessa ? `Commessa: ${todo.commessa}` : "",
        todo.client ? `Cliente: ${todo.client}` : "",
        todo.businessunit ? `BU: ${todo.businessunit}` : "",
      ]
        .filter(Boolean)
        .join("\\n");

      calendar.createEvent({
        id: todo.id,
        start: start,
        end: end,
        summary: todo.title || "To-Do",
        description: description,
        location: todo.client || "",
        status: todo.completed ? "CONFIRMED" : "TENTATIVE",
        categories: [
          "To-Do",
          todo.businessunit || "Task",
          todo.completed ? "Completato" : "Da fare",
        ].filter(Boolean),
      });
    });

    // Aggiungi eventi per ogni task
    (tasks || []).forEach((task: any) => {
      let start = task.startdate ? new Date(task.startdate) : new Date();
      let end = task.enddate
        ? new Date(task.enddate)
        : (() => {
            const e = new Date(start);
            if (task.hours) {
              e.setHours(e.getHours() + task.hours);
            } else {
              e.setHours(e.getHours() + 1);
            }
            return e;
          })();

      const description = [
        task.description || "",
        task.commessa ? `Commessa: ${task.commessa}` : "",
        task.client ? `Cliente: ${task.client}` : "",
        task.hours ? `Ore: ${task.hours}` : "",
      ]
        .filter(Boolean)
        .join("\\n");

      calendar.createEvent({
        id: task.id,
        start: start,
        end: end,
        summary: task.commessa ? `[Task] ${task.commessa}` : "Task di Progetto",
        description: description,
        location: task.client || "",
        status:
          task.status === "completed" || task.status === "done"
            ? "CONFIRMED"
            : "TENTATIVE",
        categories: ["Task", task.status || "pending"].filter(Boolean),
      });
    });

    // Genera .ics
    const icsContent = calendar.toString();

    return new Response(icsContent, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="calendar-${resourceId}.ics"`,
        "Cache-Control": "no-cache, must-revalidate",
        "X-WR-CALDESC": `Pianificazione task per ${memberName}`,
        "X-WR-CALNAME": `Task ${memberName}`,
        Refresh: "900",
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
