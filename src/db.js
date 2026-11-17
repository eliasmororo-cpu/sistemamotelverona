const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ARQUIVO = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'motel.db');

function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

function conferirSenha(senha, salvo) {
  if (!salvo) return false;
  const [sal, hash] = salvo.split(':');
  const teste = crypto.scryptSync(String(senha), sal, 64);
  const original = Buffer.from(hash, 'hex');
  return original.length === teste.length && crypto.timingSafeEqual(original, teste);
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS configuracoes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('admin','gerente','atendente','camareira')),
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  hora_adicional REAL NOT NULL DEFAULT 0,
  tolerancia_min INTEGER NOT NULL DEFAULT 15,
  pernoite_preco REAL NOT NULL DEFAULT 0,
  pernoite_inicio TEXT NOT NULL DEFAULT '20:00',
  pernoite_fim_venda TEXT NOT NULL DEFAULT '05:00',
  pernoite_fim TEXT NOT NULL DEFAULT '12:00',
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS periodos (
  id INTEGER PRIMARY KEY,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id),
  nome TEXT NOT NULL,
  minutos INTEGER NOT NULL,
  preco REAL NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS quartos (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id),
  status TEXT NOT NULL DEFAULT 'livre' CHECK (status IN ('livre','ocupado','limpeza','manutencao')),
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  preco REAL NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS caixas (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  aberto_em TEXT NOT NULL,
  fechado_em TEXT,
  valor_inicial REAL NOT NULL DEFAULT 0,
  valor_contado REAL,
  esperado_dinheiro REAL,
  diferenca REAL
);

CREATE TABLE IF NOT EXISTS movimentos_caixa (
  id INTEGER PRIMARY KEY,
  caixa_id INTEGER NOT NULL REFERENCES caixas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('sangria','suprimento')),
  valor REAL NOT NULL,
  motivo TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locacoes (
  id INTEGER PRIMARY KEY,
  quarto_id INTEGER NOT NULL REFERENCES quartos(id),
  placa TEXT,
  sem_veiculo INTEGER NOT NULL DEFAULT 0,
  veiculo TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('periodo','pernoite')),
  periodo_id INTEGER REFERENCES periodos(id),
  periodo_nome TEXT,
  preco_base REAL NOT NULL,
  hora_adicional REAL NOT NULL,
  tolerancia_min INTEGER NOT NULL,
  entrada TEXT NOT NULL,
  limite TEXT NOT NULL,
  saida TEXT,
  horas_adicionais INTEGER,
  valor_quarto REAL,
  valor_consumo REAL,
  desconto REAL NOT NULL DEFAULT 0,
  desconto_motivo TEXT,
  desconto_autorizado_por INTEGER REFERENCES usuarios(id),
  total REAL,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','fechada','cancelada')),
  cancel_motivo TEXT,
  cancel_autorizado_por INTEGER REFERENCES usuarios(id),
  usuario_entrada INTEGER NOT NULL REFERENCES usuarios(id),
  usuario_saida INTEGER REFERENCES usuarios(id),
  caixa_id INTEGER REFERENCES caixas(id)
);
CREATE INDEX IF NOT EXISTS idx_locacoes_entrada ON locacoes(entrada);
CREATE INDEX IF NOT EXISTS idx_locacoes_placa ON locacoes(placa);

CREATE TABLE IF NOT EXISTS consumos (
  id INTEGER PRIMARY KEY,
  locacao_id INTEGER NOT NULL REFERENCES locacoes(id),
  produto_id INTEGER REFERENCES produtos(id),
  nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  preco_unit REAL NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY,
  locacao_id INTEGER NOT NULL REFERENCES locacoes(id),
  caixa_id INTEGER NOT NULL REFERENCES caixas(id),
  forma TEXT NOT NULL CHECK (forma IN ('dinheiro','pix','debito','credito')),
  valor REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS limpezas (
  id INTEGER PRIMARY KEY,
  quarto_id INTEGER NOT NULL REFERENCES quartos(id),
  locacao_id INTEGER REFERENCES locacoes(id),
  inicio TEXT NOT NULL,
  fim TEXT,
  usuario_id INTEGER REFERENCES usuarios(id)
);

-- Registro de tudo que foi feito e por quem. Não existe rota que apague ou altere esta tabela.
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  acao TEXT NOT NULL,
  detalhe TEXT,
  criado_em TEXT NOT NULL
);
`;

function abrir(arquivo = ARQUIVO) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec(SCHEMA);
  semear(db);
  return db;
}

// Dados iniciais de EXEMPLO. Ajuste quartos, categorias, preços e produtos na tela "Configurar".
function semear(db) {
  const temUsuario = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  if (temUsuario) return;
  const agora = new Date().toISOString();
  db.prepare('INSERT INTO usuarios (nome, login, senha_hash, papel) VALUES (?,?,?,?)')
    .run('Administrador', 'admin', hashSenha(process.env.ADMIN_SENHA || 'admin123'), 'admin');

  const cfg = db.prepare('INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?,?)');
  cfg.run('nome_motel', 'Motel');
  cfg.run('dias_guardar_placa', '90');

  const cat = db.prepare(`INSERT INTO categorias (nome, hora_adicional, tolerancia_min, pernoite_preco)
    VALUES (?,?,?,?)`);
  const per = db.prepare('INSERT INTO periodos (categoria_id, nome, minutos, preco) VALUES (?,?,?,?)');
  const standard = cat.run('Standard', 20, 15, 150).lastInsertRowid;
  per.run(standard, '2 horas', 120, 60);
  per.run(standard, '3 horas', 180, 80);
  const luxo = cat.run('Luxo (hidro)', 30, 15, 250).lastInsertRowid;
  per.run(luxo, '2 horas', 120, 100);
  per.run(luxo, '3 horas', 180, 130);

  const q = db.prepare('INSERT INTO quartos (numero, categoria_id) VALUES (?,?)');
  for (let i = 1; i <= 8; i++) q.run(String(i).padStart(2, '0'), standard);
  for (let i = 9; i <= 10; i++) q.run(String(i).padStart(2, '0'), luxo);

  const prod = db.prepare('INSERT INTO produtos (nome, preco) VALUES (?,?)');
  [['Água', 5], ['Refrigerante lata', 8], ['Cerveja lata', 10], ['Energético', 15], ['Preservativo', 6]]
    .forEach(([n, p]) => prod.run(n, p));

  db.prepare('INSERT INTO auditoria (acao, detalhe, criado_em) VALUES (?,?,?)')
    .run('sistema_iniciado', 'Banco criado com dados de exemplo', agora);
}

module.exports = { abrir, hashSenha, conferirSenha };
