const ical = require('ical-generator');
const { createClient } = require('@supabase/supabase-js');

module.exports = async function (context, req) {
  const resourceId = context.bindingData.resourceId;

  if (!resourceId) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing resourceId" })
    };
    return;
  }

  try {
    // Inizializza Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Supabase not configured" })
      };
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Recupera i todos per questa risorsa
    const { data: todos, error: todosError } = await supabase
      .from('todos')
      .select('*')
      .eq('resourceId', resourceId)
      .order('dueDate', { ascending: true });

    if (todosError) {
      throw todosError;
    }

    // Recupera info membro
    const { data: member } = await supabase
      .from('members')
      .select('name')
      .eq('id', resourceId)
      .single();

    const memberName = member?.name || "Risorsa";

    // Crea calendario iCal
    const calendar = ical({
      name: `Task ${memberName}`,
      description: `Pianificazione task per ${memberName}`,
      timezone: 'Europe/Rome',
      ttl: 900, // Refresh ogni 15 minuti (in secondi)
      prodId: {
        company: 'AppTaskBI',
        product: 'Task Calendar',
        language: 'IT'
      }
    });

    // Aggiungi eventi per ogni todo
    (todos || []).forEach(todo => {
      // Usa dueDate se presente, altrimenti createdAt
      let start = todo.dueDate ? new Date(todo.dueDate) : (todo.createdAt ? new Date(todo.createdAt) : new Date());
      
      // Imposta orario di default a 09:00 se è solo data
      if (todo.dueDate && !todo.dueDate.includes('T')) {
        start.setHours(9, 0, 0, 0);
      }
      
      // Evento di 1 ora di default
      let end = new Date(start);
      end.setHours(start.getHours() + 1);

      const description = [
        todo.description || '',
        todo.commessa ? `Commessa: ${todo.commessa}` : '',
        todo.client ? `Cliente: ${todo.client}` : '',
        todo.businessUnit ? `BU: ${todo.businessUnit}` : ''
      ].filter(Boolean).join('\\n');

      calendar.createEvent({
        id: todo.id,
        start: start,
        end: end,
        summary: todo.title || 'Task',
        description: description,
        location: todo.client || '',
        status: todo.completed ? 'CONFIRMED' : 'TENTATIVE',
        categories: [
          todo.businessUnit || 'Task',
          todo.completed ? 'Completato' : 'Da fare'
        ].filter(Boolean)
      });
    });

    // Genera .ics
    const icsContent = calendar.toString();

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="calendar-${resourceId}.ics"`,
        "Cache-Control": "no-cache, must-revalidate",
        "X-WR-CALDESC": `Pianificazione task per ${memberName}`,
        "X-WR-CALNAME": `Task ${memberName}`,
        "Refresh": "900" // Suggerisce refresh ogni 15 min
      },
      body: icsContent
    };

  } catch (err) {
    console.error("Errore generazione calendario:", err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        error: "Errore nella generazione del calendario",
        details: err.message 
      })
    };
  }
};
