import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../app/lib/rentalsAPI', () => ({
  getRentals: vi.fn(async () => []),
  getRentalStats: vi.fn(async () => ({
    total: 59,
    em_andamento: 57,
    atrasado: 2,
    valor_em_aberto: 1627477.36,
    valor_mensal: 18000,
  })),
  getRentalById: vi.fn(),
  createRental: vi.fn(),
  updateRental: vi.fn(),
  setRentalStatus: vi.fn(),
  returnRental: vi.fn(),
  cancelRental: vi.fn(),
  faturarRental: vi.fn(),
  getRentalBillings: vi.fn(),
  deleteRental: vi.fn(),
  generateReceipt: vi.fn(),
  getRentalExtras: vi.fn(),
  addRentalExtra: vi.fn(),
  deleteRentalExtra: vi.fn(),
  getRentalDocuments: vi.fn(),
  addRentalDocument: vi.fn(),
  deleteRentalDocument: vi.fn(),
  generateContract: vi.fn(),
  contractPdfUrl: vi.fn(),
}));

vi.mock('../app/lib/vehiclesAPI', () => ({ getVehicles: vi.fn(async () => []) }));
vi.mock('../app/lib/clientsAPI', () => ({ getClients: vi.fn(async () => []) }));
vi.mock('../app/lib/configOptionsAPI', () => ({ getOptions: vi.fn(async () => []) }));
vi.mock('../app/lib/uploadsAPI', () => ({ uploadFile: vi.fn() }));

import Locacoes from '../app/locacao/Locacoes';

describe('Locações', () => {
  it('exibe separadamente o total dos contratos e a projeção mensal de 30 dias', async () => {
    render(<Locacoes />);

    const mensal = await screen.findByText('Valor mensal (30 dias)');
    expect(mensal.closest('.clients-summary-card')).toHaveTextContent('R$ 18.000,00');

    const aberto = screen.getByText('Valor em aberto');
    expect(aberto.closest('.clients-summary-card')).toHaveTextContent('R$ 1.627.477,36');
  });
});
