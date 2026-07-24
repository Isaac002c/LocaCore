// =============================================================================
// tx.js — Helper de transação de banco genérico (BEGIN/COMMIT/ROLLBACK).
// Mesmo padrão do repositório financeiro (financeRepo.withTransaction), porém
// genérico: entrega o CLIENT do pg para o callback, que deve passar `client`
// como executor (db) às funções de model transacionais.
// Aceita um pool alternativo (útil em testes com pg-mem).
// =============================================================================

function createTxRunner(customPool) {
  const activePool = customPool || require('../config/db');
  return async function withTransaction(fn) {
    const client = await activePool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  };
}

// Runner padrão (produção). Lazy: só carrega o pool quando efetivamente usado.
const withTransaction = (fn) => createTxRunner()(fn);

module.exports = { withTransaction, createTxRunner };
