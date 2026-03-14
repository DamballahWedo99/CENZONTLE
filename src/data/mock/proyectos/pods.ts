import { Pod } from '@/types/proyectos';

export const mockPods: Pod[] = [
  {
    id: 'pod-1',
    name: 'Payments Backend',
    description:
      'Procesamiento de pagos, integraciones con procesadores y reconciliación',
    productOwnerIds: ['po-1', 'po-2'],
    color: '#3b82f6',
  },
  {
    id: 'pod-2',
    name: 'Frontend Digital',
    description: 'Experiencia web, checkout y portal de clientes',
    productOwnerIds: ['po-3'],
    color: '#8b5cf6',
  },
  {
    id: 'pod-3',
    name: 'Loyalty & Rewards',
    description: 'Programa de lealtad, puntos y recompensas',
    productOwnerIds: ['po-4'],
    color: '#f59e0b',
  },
  {
    id: 'pod-4',
    name: 'Platform Infrastructure',
    description:
      'Infraestructura cloud, CI/CD, observabilidad y seguridad',
    productOwnerIds: ['po-5'],
    color: '#10b981',
  },
  {
    id: 'pod-5',
    name: 'Mobile Experience',
    description:
      'App móvil iOS/Android, notificaciones push y experiencia nativa',
    productOwnerIds: ['po-6'],
    color: '#ef4444',
  },
];
