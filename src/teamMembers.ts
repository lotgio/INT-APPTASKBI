export type TeamGroup = "BI" | "CRM" | "DEV" | "CONSULENTI HBO" | "CONSULENTI PMI (S)";

export const TEAM_MEMBERS: Record<TeamGroup, string[]> = {
  BI: ["Lotta Giorgia", "Favero Matteo", "Stocco Alberto", "Vita Anna"],
  CRM: ["Mason Mauro", "Padovan Matteo", "Micheletto Nicola"],
  DEV: ["Albanese Lorenzo", "Brigo Matteo", "Brotto Fabio", "Cecchin Chiara", "Cestaro Luca", "Dian Enrico", "Luise Alessandro", "Marino Daniele", "Verzotto Maria", "Rampazzo Lisa", "Sarto Michele", "Omodei Cesare"],
  "CONSULENTI HBO": ["Agostini Nicolò", "Corato Cinzia", "Lovo Ilaria", "Messina Angela", "Modolo Meri", "Toncelli Michele", "Villani Riccardo", "Vivoda Fabio"],
  "CONSULENTI PMI (S)": ["Aquilino Graziano", "Maso Giuliano", "Pandolfo Piero", "Prando Gloria", "Rossi Michela", "Stramazzo Andrea", "Turcato Luca", "Zanetti Paolo"]
};
