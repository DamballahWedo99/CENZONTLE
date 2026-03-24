/**
 * Ecosystems Configuration
 *
 * Configuration for different ecosystem modules in the application
 */

export interface Ecosystem {
  name: string;
  logo: string;
  plan: string;
}

export const ecosystems: Ecosystem[] = [
  {
    name: 'Aprobación',
    logo: '/logos/aprobacion.svg',
    plan: 'Dashboard'
  },
  {
    name: 'Análisis',
    logo: '/logos/analisis.svg',
    plan: 'Analytics'
  },
  {
    name: 'Operaciones',
    logo: '/logos/operaciones.svg',
    plan: 'Operations'
  }
];
