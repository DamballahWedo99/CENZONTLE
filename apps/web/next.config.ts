import type { NextConfig } from "next";

// Nota: `turbopack.root` se elimino intencionalmente — en este worktree
// introducia paths concatenados con ':' en la resolucion de modulos
// (tailwindcss dejaba de resolver). Next 16 auto-detecta el workspace root
// via pnpm-lock.yaml; el warning "multiple lockfiles detected" es benigno.
const nextConfig: NextConfig = {};

export default nextConfig;
