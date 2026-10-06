/** Orden de potencial para listados y la cola de "Siguiente prospecto" (alto primero). Tabla con alias p. */
export const POTENTIAL_ORDER = `CASE p.potential_level WHEN 'alto' THEN 0 WHEN 'medio' THEN 1 WHEN 'bajo' THEN 2 ELSE 3 END`;
