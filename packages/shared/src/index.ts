// Domain types
export * from "./types/proyectos";
export * from "./types/factory";
export * from "./types/auth";
export * from "./types/aprobacion";
export * from "./types/reportes";
export * from "./types/integrations";
export * from "./types/access";
export * from "./types/external-secrets";
export * from "./types/agent-token-settings";
export * from "./types/branding-settings";
export * from "./types/doom-loop";
export * from "./types/vault";

// Diagram quality metrics — usado por el frontend `ValidationPanel` para
// mostrar el score deterministic (0-1) del diagrama actual al usuario.
// Originalmente también era consumido por un backend quality refinement
// loop; ese loop se removió tras comprobar que es matemáticamente inútil
// (ELK es determinístico dada la misma topología; reorder de arrays solo
// es tie-break marginal). Se mantiene en shared por si en el futuro un
// agente pre-submit necesitara auto-evaluar su output antes de emitir.
export * from "./diagram-quality-metrics";
