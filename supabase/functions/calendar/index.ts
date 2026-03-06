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
      });
    });

    // Aggiungi eventi per ogni task
    (tasks || []).forEach((task: any) => {
      // Per i task, usa le date (all-day event) - supporta range multi-giorno
      let startDate = task.startdate ? task.startdate.split("T")[0] : new Date().toISOString().split("T")[0];
      let endDate = task.enddate ? task.enddate.split("T")[0] : startDate;
      
      // Se endDate è lo stesso giorno di startDate, aggiungi 1 giorno per far risultare almeno 1 giorno pieno in Outlook
      if (endDate === startDate) {
        const nextDay = new Date(startDate + "T00:00:00");
        nextDay.setDate(nextDay.getDate() + 1);
        endDate = nextDay.toISOString().split("T")[0];
      } else {
        // Se è multi-giorno, aggiungi 1 giorno alla fine (convenzione iCal per all-day)
        const nextDay = new Date(endDate + "T00:00:00");
        nextDay.setDate(nextDay.getDate() + 1);
        endDate = nextDay.toISOString().split("T")[0];
      }

      const description = [
        task.commessa ? `Commessa: ${task.commessa}` : "",
        task.hours ? `Ore assegnate: ${task.hours}` : "",
        task.description || "",
      ]
        .filter(Boolean)
        .join("\\n");

      calendar.createEvent({
        id: task.id,
        start: startDate,
        end: endDate,
        summary: `${task.client || "Task"} | ${task.description || "Senza descrizione"}`,
        description: description,
        allDay: true,
        status:
          task.status === "completed" || task.status === "done"
            ? "CONFIRMED"
            : "TENTATIVE",
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
