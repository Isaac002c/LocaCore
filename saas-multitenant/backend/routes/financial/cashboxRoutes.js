const express = require('express');
const router = express.Router();
const model = require('../../models/financialTransactionModels');
const { requireFinanceRead } = require('../../middlewares/financeAccess');
const { getWeekRangeByOffset } = require('../../services/finance/calc');

// GET /api/financial/cashbox — Caixa Semanal
// Query: week_offset (0=semana atual, -1 anterior, +1 próxima) OU start&end (período).
// Semana = SEGUNDA a DOMINGO (ISO). O backend é a fonte da verdade do intervalo.
// Retorna: range + summary (agregados no banco) + transactions (paginado).
router.get('/', requireFinanceRead, async (req, res) => {
  try {
    let start = req.query.start;
    let end = req.query.end;

    if (!start || !end) {
      const offset = parseInt(req.query.week_offset, 10) || 0;
      const range = getWeekRangeByOffset(offset, new Date(), 1);
      start = range.start;
      end = range.end;
    }

    const filters = {
      date_from: start,
      date_to: end,
      type: req.query.type,
      category_id: req.query.category_id,
      status: req.query.status,
      payment_method: req.query.payment_method,
      client_id: req.query.client_id,
      fine_id: req.query.fine_id,
    };

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    // Semana anterior (mesmos filtros, range deslocado) para comparação.
    const prevRange = getWeekRangeByOffset(-1, start, 1);

    const [summary, previous, list] = await Promise.all([
      model.getSummary(req.tenantId, filters),
      model.getSummary(req.tenantId, { ...filters, date_from: prevRange.start, date_to: prevRange.end }),
      model.listTransactions(req.tenantId, { ...filters, limit, offset: (page - 1) * limit, sort: 'transaction_date', order: 'asc' }),
    ]);

    res.json({
      success: true,
      data: {
        range: { start, end, week_starts_on: 'monday' },
        summary,
        previous: { range: prevRange, ...previous },
        transactions: list.rows,
        pagination: { page, limit, total: list.total, pages: Math.ceil(list.total / limit) },
      },
    });
  } catch (err) {
    console.error('[finance] caixa semanal:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao calcular o caixa' });
  }
});

module.exports = router;
