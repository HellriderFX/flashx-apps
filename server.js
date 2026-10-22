require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const seedApps = require('./seed-apps.json');

const requiredEnv = ['DATABASE_URL', 'SITE_USERNAME', 'SITE_PASSWORD', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}
if (process.env.SITE_PASSWORD.length < 12 || process.env.ADMIN_PASSWORD.length < 12) {
  console.error('SITE_PASSWORD and ADMIN_PASSWORD must each be at least 12 characters long.');
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters long.');
  process.exit(1);
}

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
const PgSession = connectPgSimple(session);
const sessionStore = new PgSession({
  pool,
  tableName: 'flashx_sessions',
  createTableIfMissing: true,
  pruneSessionInterval: 900
});
const sitePasswordHash = bcrypt.hash(process.env.SITE_PASSWORD, 12);
const adminPasswordHash = bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
const iconUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProduction ? '1d' : 0 }));
app.use(session({
  name: 'flashx.sid',
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function timingSafeStringEqual(first, second) {
  const a = Buffer.from(String(first ?? ''));
  const b = Buffer.from(String(second ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function safeImageUrl(value) {
  const candidate = String(value || '').trim();
  if (/^\/assets\/[A-Za-z0-9._-]+$/.test(candidate)) return candidate;
  if (/^\/uploads\/\d+$/.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:') return url.href;
  } catch (_) {}
  return '';
}

function safeDownloadUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.href : '';
  } catch (_) {
    return '';
  }
}

function pageShell(title, content, extraHead = '') {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#101b16">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0b100e;--surface:#151c19;--surface2:#202a24;--green:#75e39a;--text:#f1f5f2;--muted:#aab6ae;--line:#2c3831;--danger:#ff8f8f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}a{color:inherit}.wrap{max-width:1100px;margin:auto;padding:0 20px 48px}.top{min-height:68px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);color:var(--muted)}.brand{width:32px;height:32px;object-fit:cover;border-radius:9px}.catalog-brand{width:44px;height:44px;object-fit:contain;border-radius:10px}.top strong{color:var(--text)}.top .spacer{flex:1}.top a{color:var(--green);text-decoration:none;font-size:14px;font-weight:700}.hero{padding:36px 0 26px}.hero h1{font-size:clamp(30px,5vw,46px);line-height:1.12;margin:0 0 10px;letter-spacing:-.035em}.hero p{color:var(--muted);margin:0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card,.panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px}.card{display:flex;flex-direction:column;align-items:flex-start;min-width:0}.card-icon{width:76px;height:76px;object-fit:cover;border-radius:18px;border:1px solid var(--line);margin-bottom:12px}.icon-current{display:flex;align-items:center;gap:12px;margin-top:16px}.icon-current .card-icon{margin:0}.brand-preview{width:104px;height:80px;object-fit:contain;background:#0b100e;border:1px solid var(--line);border-radius:10px;padding:6px}.no-icon{display:grid;place-items:center;text-align:center;background:var(--surface2);color:var(--muted);font-size:12px;overflow-wrap:anywhere;padding:6px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--green);font-weight:750}.card h2{font-size:20px;line-height:1.25;margin:7px 0 8px;overflow-wrap:anywhere}.card .desc{color:var(--muted);font-size:14px;margin:0 0 14px}.meta{width:100%;background:var(--surface2);border-radius:12px;padding:11px 13px;margin:0 0 16px;color:var(--muted);font-size:13px;overflow-wrap:anywhere}.meta p{margin:0 0 7px}.meta p:last-child{margin-bottom:0}.meta strong{color:var(--text)}.meta .codes{color:var(--green);font-weight:750}.meta .variant{border-top:1px solid var(--line);padding-top:8px;margin-top:9px}.download{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 20px;border-radius:999px;background:var(--green);color:#102218;text-decoration:none;font-weight:800;margin-top:auto}.download:hover{background:#92f0ae}.footer{font-size:12px;color:#829087;margin-top:22px}.admin-wrap{max-width:760px;margin:34px auto;padding:0 18px}.panel h1{margin-top:0}.panel label{display:block;font-weight:700;margin:14px 0 6px}.panel input,.panel textarea,.panel select{width:100%;border:1px solid var(--line);border-radius:9px;background:#0e1511;color:var(--text);padding:11px;font:inherit}.panel textarea{min-height:130px;resize:vertical}.button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:9px;background:var(--green);color:#102218;text-decoration:none;font-weight:800;padding:11px 16px;cursor:pointer}.button.secondary{background:#2a3730;color:var(--text)}.button.danger{background:#592d2d;color:#ffe1e1}.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}.error{background:#442626;color:#ffdada;border-radius:9px;padding:10px 12px;margin:12px 0}.success{color:var(--green)}.admin-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.admin-row:last-child{border-bottom:0}.admin-row small{display:block;color:var(--muted)}.checkbox{display:flex!important;gap:9px;align-items:center}.checkbox input{width:auto}.muted{color:var(--muted)}.logout{margin:0}.logout button{background:none;border:0;color:var(--muted);font:inherit;cursor:pointer;padding:0}.logout button:hover{color:var(--green)}
@media(max-width:680px){.wrap{padding:0 14px 34px}.grid{grid-template-columns:1fr}.card,.panel{padding:17px}.hero{padding:28px 0 20px}.admin-row{align-items:flex-start;flex-direction:column}}
</style>
${extraHead}
</head>
<body>${content}</body>
</html>`;
}

function codeMarkup(line) {
  const safeLine = escapeHtml(line);
  const match = line.match(/^([^:]+):\s*(.*)$/);
  if (match) {
    return `<p><strong>${escapeHtml(match[1])}:</strong> <span class="codes">${escapeHtml(match[2])}</span></p>`;
  }
  if (/^Versão /i.test(line) || /^Arquivo:/i.test(line)) {
    return `<p class="variant">${safeLine}</p>`;
  }
  return `<p>${safeLine || '&nbsp;'}</p>`;
}

function renderAppCard(item) {
  const icon = safeImageUrl(item.icon_url);
  const iconMarkup = icon
    ? `<img class="card-icon" src="${escapeAttr(icon)}" alt="Ícone de ${escapeAttr(item.name)}" loading="lazy">`
    : `<div class="card-icon no-icon" role="img" aria-label="Sem ícone para ${escapeAttr(item.name)}">Ícone de ${escapeHtml(item.name)}</div>`;
  const downloadUrl = safeDownloadUrl(item.download_url);
  const meta = [];
  if (item.size_text) meta.push(`<p><strong>Tamanho:</strong> ${escapeHtml(item.size_text)}</p>`);
  if (item.platform) meta.push(`<p><strong>Sistema:</strong> ${escapeHtml(item.platform)}</p>`);
  if (item.details) {
    item.details.split(/\r?\n/).forEach((line) => meta.push(codeMarkup(line)));
  }
  const metaBlock = meta.length ? `<div class="meta">${meta.join('')}</div>` : '';
  const button = downloadUrl
    ? `<a class="download" href="${escapeAttr(downloadUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.button_label || 'Abrir download')}</a>`
    : '';
  return `<article class="card">
    ${iconMarkup}
    <div class="eyebrow">${escapeHtml(item.subtitle || 'Aplicativo Android')}</div>
    <h2>${escapeHtml(item.name)}</h2>
    <p class="desc">${escapeHtml(item.description || '')}</p>
    ${metaBlock}
    ${button}
  </article>`;
}

function renderCatalog(items, req) {
  const cards = items.map(renderAppCard).join('\n');
  const csrfToken = ensureCsrf(req);
  const content = `<div class="wrap">
    <header class="top"><img class="brand catalog-brand" src="/branding/logo" alt="Logo FLASHX"><strong>FLASHX</strong><span>·</span><span>Central de Aplicativos</span><span class="spacer"></span><a href="/admin">Administração</a><form method="post" action="/logout" class="logout"><input type="hidden" name="csrfToken" value="${escapeAttr(csrfToken)}"><button type="submit">Sair</button></form></header>
    <section class="hero"><h1>Aplicativos FLASHX</h1><p>Escolha o aplicativo desejado. Cada opção tem seu próprio link, ícone e informações de download.</p></section>
    <section class="grid" aria-label="Aplicativos disponíveis">${cards}</section>
    <footer class="footer">Use os códigos apenas no aplicativo e serviço correspondente. Instale APKs somente quando confiar na origem.</footer>
  </div>`;
  return pageShell('Aplicativos FLASHX — Central de aplicativos', content);
}

function ensureCsrf(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function csrfValid(req) {
  const token = String(req.body.csrfToken || '');
  const expected = String(req.session.csrfToken || '');
  if (!token || !expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireCsrf(req, res, next) {
  if (!csrfValid(req)) return res.status(403).send(pageShell('Solicitação inválida', '<main class="admin-wrap"><section class="panel"><h1>Solicitação inválida</h1><p>Atualize a página e tente novamente.</p><a class="button" href="/admin">Voltar</a></section></main>'));
  next();
}

function requireSiteAccess(req, res, next) {
  if (!req.session.hasCatalogAccess && !req.session.isAdmin) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.redirect('/admin/login');
  next();
}

function siteLoginPage(token, error = '') {
  const content = `<main class="admin-wrap"><section class="panel">
    <div class="eyebrow">FLASHX · acesso protegido</div><h1>Central de aplicativos</h1>
    <p class="muted">Entre com o usuário e a senha fornecidos para acessar o catálogo.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="/login">
      <input type="hidden" name="csrfToken" value="${escapeAttr(token)}">
      <label for="username">Usuário</label><input id="username" name="username" autocomplete="username" required>
      <label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required>
      <div class="actions"><button class="button" type="submit">Entrar</button></div>
    </form>
  </section></main>`;
  return pageShell('Acesso — FLASHX', content);
}

function loginPage(token, error = '') {
  const content = `<main class="admin-wrap"><section class="panel">
    <div class="eyebrow">FLASHX · acesso restrito</div><h1>Painel administrativo</h1>
    <p class="muted">Entre com as credenciais configuradas no servidor.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="/admin/login">
      <input type="hidden" name="csrfToken" value="${escapeAttr(token)}">
      <label for="username">Usuário</label><input id="username" name="username" autocomplete="username" required>
      <label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required>
      <div class="actions"><button class="button" type="submit">Entrar</button><a class="button secondary" href="/">Voltar ao catálogo</a></div>
    </form>
  </section></main>`;
  return pageShell('Login administrativo — FLASHX', content);
}

function adminFrame(req, title, body) {
  const token = ensureCsrf(req);
  const content = `<main class="admin-wrap"><header class="top" style="margin-bottom:20px"><img class="brand" src="/branding/logo" alt="FLASHX"><strong>FLASHX Admin</strong><span class="spacer"></span><a href="/">Ver catálogo</a></header>${body}
    <form method="post" action="/admin/logout" class="actions"><input type="hidden" name="csrfToken" value="${escapeAttr(token)}"><button class="button secondary" type="submit">Sair</button></form></main>`;
  return pageShell(title, content);
}

function adminListPage(req, items) {
  const rows = items.map((item) => `<div class="admin-row"><div><strong>${escapeHtml(item.name)}</strong><small>Ordem ${item.display_order} · ${item.is_active ? 'Publicado' : 'Oculto'}</small></div><a class="button secondary" href="/admin/apps/${item.id}/edit">Editar</a></div>`).join('');
  const imported = Number.parseInt(req.query.imported, 10);
  const logoErrorMessages = {
    missing: 'Escolha um arquivo PNG antes de enviar.',
    invalid: 'O arquivo selecionado não é um PNG válido.',
    too_large: 'A imagem PNG deve ter até 5 MB.',
    read_error: 'Não foi possível ler a imagem. Selecione um PNG e tente novamente.'
  };
  const logoError = logoErrorMessages[String(req.query.logoError || '')];
  const notices = [];
  if (imported > 0) notices.push(`<p class="success">${imported} aplicativos importados/atualizados no Neon.</p>`);
  if (req.query.logoUpdated) notices.push('<p class="success">Logo do cabeçalho atualizada.</p>');
  if (req.query.logoRemoved) notices.push('<p class="success">Logo enviada removida; a logo padrão do projeto foi restaurada.</p>');
  if (logoError) notices.push(`<p class="error">${escapeHtml(logoError)}</p>`);
  const message = notices.join('');
  const token = ensureCsrf(req);
  const body = `<section class="panel"><div class="eyebrow">Área protegida</div><h1>Gerenciar aplicativos</h1><p class="muted">Os itens ativos aparecem no catálogo. Alterações são salvas no Neon.</p>${message}<div class="actions"><a class="button" href="/admin/apps/new">Adicionar aplicativo</a></div>${rows || '<p>Nenhum aplicativo cadastrado.</p>'}</section>
    <section class="panel" style="margin-top:18px"><h2>Importar catálogo privado</h2><p class="muted">Cole aqui o conteúdo do arquivo JSON privado entregue junto com o projeto. Os dados serão gravados somente no Neon.</p><form method="post" action="/admin/apps/import"><input type="hidden" name="csrfToken" value="${escapeAttr(token)}"><label for="appsJson">Dados JSON</label><textarea id="appsJson" name="appsJson" required placeholder="Cole o conteúdo do arquivo JSON privado"></textarea><div class="actions"><button class="button" type="submit">Importar/atualizar catálogo</button></div></form></section>
    <section class="panel" style="margin-top:18px"><h2>Logo do cabeçalho</h2><p class="muted">A mesma logo aparece no cabeçalho do catálogo e do painel FLASHX Admin. Envie uma imagem PNG do celular ou computador; ela será guardada no Neon.</p><div class="icon-current"><img class="brand-preview" src="/branding/logo" alt="Logo atual"><span class="muted">Logo atual</span></div><form method="post" action="/admin/branding/logo" enctype="multipart/form-data"><input type="hidden" name="csrfToken" value="${escapeAttr(token)}"><label for="logo_png">Selecionar imagem PNG</label><input id="logo_png" name="logo_png" type="file" accept="image/png,.png" required><p class="muted">Tamanho máximo: 5 MB.</p><div class="actions"><button class="button" type="submit">Adicionar/substituir logo</button></div></form><form method="post" action="/admin/branding/logo/remove"><input type="hidden" name="csrfToken" value="${escapeAttr(token)}"><div class="actions"><button class="button secondary" type="submit">Remover logo enviada</button></div><p class="muted">A remoção restaura a logo padrão do projeto.</p></form></section>`;
  return adminFrame(req, 'Gerenciar aplicativos — FLASHX', body);
}

function adminFormPage(req, item = {}, error = '') {
  const token = ensureCsrf(req);
  const isNew = !item.id;
  const val = (key) => escapeAttr(item[key] ?? '');
  const currentIcon = safeImageUrl(item.icon_url);
  const currentIconMarkup = currentIcon
    ? `<img class="card-icon" src="${escapeAttr(currentIcon)}" alt="Ícone atual">`
    : `<div class="card-icon no-icon">Sem ícone</div>`;
  const iconRemovedMessage = req.query.iconRemoved ? '<p class="success">Ícone removido. O cartão exibirá o espaço reservado.</p>' : '';
  const body = `<section class="panel"><div class="eyebrow">${isNew ? 'Novo item' : 'Editar item'}</div><h1>${isNew ? 'Adicionar aplicativo' : escapeHtml(item.name)}</h1>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}${iconRemovedMessage}
    <form method="post" action="/admin/apps/save" enctype="multipart/form-data">
      <input type="hidden" name="csrfToken" value="${escapeAttr(token)}"><input type="hidden" name="id" value="${val('id')}">
      <label for="name">Nome do aplicativo</label><input id="name" name="name" maxlength="160" value="${val('name')}" required>
      <label for="slug">Identificador (slug)</label><input id="slug" name="slug" maxlength="80" value="${val('slug')}" placeholder="Gerado automaticamente pelo nome">
      <label for="subtitle">Linha curta</label><input id="subtitle" name="subtitle" maxlength="180" value="${val('subtitle')}" placeholder="Ex.: Aplicativo Android">
      <label for="description">Descrição</label><textarea id="description" name="description" maxlength="2000">${escapeHtml(item.description || '')}</textarea>
      <div class="icon-current">${currentIconMarkup}<span class="muted">Ícone atual</span></div>
      <label for="icon_url">Caminho do ícone ou URL HTTPS</label><input id="icon_url" name="icon_url" maxlength="500" value="${val('icon_url')}" placeholder="Escolha um PNG abaixo ou informe /assets/...">
      <label for="icon_png">Enviar ícone PNG do celular ou computador</label><input id="icon_png" name="icon_png" type="file" accept="image/png,.png">
      <p class="muted">O PNG selecionado substituirá o caminho acima. Máximo 5 MB; a imagem fica salva no Neon.</p>
      <label for="download_url">Link do download ou da loja</label><input id="download_url" name="download_url" maxlength="1000" value="${val('download_url')}" placeholder="https://...">
      <label for="button_label">Texto do botão</label><input id="button_label" name="button_label" maxlength="80" value="${val('button_label')}">
      <label for="size_text">Tamanho do arquivo</label><input id="size_text" name="size_text" maxlength="80" value="${val('size_text')}" placeholder="Ex.: 59 MB">
      <label for="platform">Sistema ou versão</label><input id="platform" name="platform" maxlength="180" value="${val('platform')}" placeholder="Ex.: Android">
      <label for="details">Códigos e observações (uma linha por item)</label><textarea id="details" name="details" maxlength="4000">${escapeHtml(item.details || '')}</textarea>
      <label for="display_order">Ordem na grade</label><input id="display_order" name="display_order" type="number" min="0" max="9999" value="${val('display_order') || '100'}">
      <label class="checkbox"><input type="checkbox" name="is_active" ${item.is_active === false ? '' : 'checked'}> Publicado no catálogo</label>
      <div class="actions"><button class="button" type="submit">Salvar</button><a class="button secondary" href="/admin">Cancelar</a></div>
    </form>
    ${!isNew && item.icon_url ? `<form method="post" action="/admin/apps/${item.id}/remove-icon"><input type="hidden" name="csrfToken" value="${escapeAttr(token)}"><div class="actions"><button class="button secondary" type="submit">Remover ícone atual</button></div></form>` : ''}
    ${!isNew ? `<form method="post" action="/admin/apps/${item.id}/delete"><input type="hidden" name="csrfToken" value="${escapeAttr(token)}"><div class="actions"><button class="button danger" type="submit">Apagar aplicativo</button></div></form>` : ''}
  </section>`;
  return adminFrame(req, isNew ? 'Adicionar aplicativo — FLASHX' : `Editar ${item.name} — FLASHX`, body);
}

function validateAppInput(body) {
  const appData = {
    name: String(body.name || '').trim().slice(0, 160),
    slug: slugify(body.slug || body.name),
    subtitle: String(body.subtitle || '').trim().slice(0, 180),
    description: String(body.description || '').trim().slice(0, 2000),
    icon_url: String(body.icon_url || '').trim().slice(0, 500),
    download_url: String(body.download_url || '').trim().slice(0, 1000),
    button_label: String(body.button_label || '').trim().slice(0, 80),
    size_text: String(body.size_text || '').trim().slice(0, 80),
    platform: String(body.platform || '').trim().slice(0, 180),
    details: String(body.details || '').trim().slice(0, 4000),
    display_order: Number.parseInt(body.display_order, 10) || 100,
    is_active: body.is_active === 'on' || body.is_active === true
  };
  if (!appData.name) return { error: 'Informe o nome do aplicativo.' };
  if (!appData.slug) return { error: 'Não foi possível gerar o identificador. Informe um slug válido.' };
  if (appData.icon_url && !/^\/assets\/[A-Za-z0-9._-]+$/.test(appData.icon_url) && !/^\/uploads\/\d+$/.test(appData.icon_url) && !/^https:\/\//i.test(appData.icon_url)) {
    return { error: 'Selecione um PNG, informe um caminho /assets/... ou uma URL HTTPS para o ícone.' };
  }
  if (appData.download_url && !/^https:\/\//i.test(appData.download_url)) {
    return { error: 'O link de download deve começar com https://.' };
  }
  return { appData };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
});

function parseIconUpload(req, res, next) {
  iconUpload.single('icon_png')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'O PNG precisa ter até 5 MB.'
      : 'Não foi possível ler o arquivo. Selecione uma imagem PNG e tente novamente.';
    res.status(400).type('html').send(adminFormPage(req, req.body || {}, message));
  });
}

function parseLogoUpload(req, res, next) {
  iconUpload.single('logo_png')(req, res, (error) => {
    if (!error) return next();
    const code = error.code === 'LIMIT_FILE_SIZE' ? 'too_large' : 'read_error';
    res.redirect(`/admin?logoError=${code}`);
  });
}

app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

app.get('/login', (req, res) => {
  if (req.session.hasCatalogAccess || req.session.isAdmin) return res.redirect('/');
  res.set('Cache-Control', 'no-store');
  res.type('html').send(siteLoginPage(ensureCsrf(req)));
});

app.post('/login', loginLimiter, requireCsrf, async (req, res, next) => {
  try {
    const usernameMatches = timingSafeStringEqual(req.body.username || '', process.env.SITE_USERNAME);
    const passwordMatches = await bcrypt.compare(String(req.body.password || ''), await sitePasswordHash);
    if (!usernameMatches || !passwordMatches) {
      return res.status(401).type('html').send(siteLoginPage(ensureCsrf(req), 'Usuário ou senha incorretos.'));
    }
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.hasCatalogAccess = true;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.redirect('/');
    });
  } catch (error) {
    next(error);
  }
});

app.post('/logout', requireSiteAccess, requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('flashx.sid', { httpOnly: true, secure: isProduction, sameSite: 'lax' });
    res.redirect('/login');
  });
});

app.get('/uploads/:id', requireSiteAccess, async (req, res, next) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).end();
  try {
    const result = await pool.query('SELECT image_data FROM app_images WHERE id=$1', [id]);
    if (!result.rowCount) return res.status(404).end();
    res.set('Content-Type', 'image/png');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(result.rows[0].image_data);
  } catch (error) {
    next(error);
  }
});

app.get('/branding/logo', requireSiteAccess, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT logo_png FROM site_branding WHERE id=1');
    if (result.rowCount && result.rows[0].logo_png) {
      res.set('Content-Type', 'image/png');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'no-store');
      return res.send(result.rows[0].logo_png);
    }
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'assets', 'flashx-header.png'));
  } catch (error) {
    next(error);
  }
});

app.get('/', requireSiteAccess, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM applications WHERE is_active = TRUE ORDER BY display_order ASC, name ASC');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(renderCatalog(result.rows, req));
  } catch (error) {
    next(error);
  }
});

app.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT id,name,display_order,is_active FROM applications ORDER BY display_order ASC, name ASC');
    res.type('html').send(adminListPage(req, result.rows));
  } catch (error) {
    next(error);
  }
});

app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.type('html').send(loginPage(ensureCsrf(req)));
});

app.post('/admin/login', loginLimiter, requireCsrf, async (req, res, next) => {
  try {
    const usernameMatches = timingSafeStringEqual(req.body.username || '', process.env.ADMIN_USERNAME);
    const passwordMatches = await bcrypt.compare(String(req.body.password || ''), await adminPasswordHash);
    if (!usernameMatches || !passwordMatches) {
      return res.status(401).type('html').send(loginPage(ensureCsrf(req), 'Usuário ou senha incorretos.'));
    }
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.isAdmin = true;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.redirect('/admin');
    });
  } catch (error) {
    next(error);
  }
});

app.post('/admin/branding/logo', requireAdmin, parseLogoUpload, requireCsrf, async (req, res, next) => {
  if (!req.file) return res.redirect('/admin?logoError=missing');
  if (req.file.buffer.length < PNG_SIGNATURE.length || !req.file.buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return res.redirect('/admin?logoError=invalid');
  }
  try {
    await pool.query(`INSERT INTO site_branding (id,logo_png,updated_at) VALUES (1,$1,NOW())
      ON CONFLICT (id) DO UPDATE SET logo_png=EXCLUDED.logo_png,updated_at=NOW()`, [req.file.buffer]);
    res.redirect('/admin?logoUpdated=1');
  } catch (error) {
    next(error);
  }
});

app.post('/admin/branding/logo/remove', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    await pool.query('UPDATE site_branding SET logo_png=NULL,updated_at=NOW() WHERE id=1');
    res.redirect('/admin?logoRemoved=1');
  } catch (error) {
    next(error);
  }
});

app.post('/admin/logout', requireAdmin, requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('flashx.sid', { httpOnly: true, secure: isProduction, sameSite: 'lax' });
    res.redirect('/login');
  });
});

app.get('/admin/apps/new', requireAdmin, (req, res) => {
  res.type('html').send(adminFormPage(req, { is_active: true, display_order: 100 }));
});

app.get('/admin/apps/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).send('Aplicativo não encontrado.');
    res.type('html').send(adminFormPage(req, result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.post('/admin/apps/save', requireAdmin, parseIconUpload, requireCsrf, async (req, res, next) => {
  if (req.file && (req.file.buffer.length < PNG_SIGNATURE.length || !req.file.buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))) {
    return res.status(400).type('html').send(adminFormPage(req, req.body, 'O arquivo selecionado não é um PNG válido.'));
  }
  const input = { ...req.body, icon_url: req.file ? '/assets/app-01.jpg' : req.body.icon_url };
  const validated = validateAppInput(input);
  if (validated.error) return res.status(400).type('html').send(adminFormPage(req, req.body, validated.error));
  const item = validated.appData;
  const id = Number.parseInt(req.body.id, 10);
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    if (req.file) {
      const image = await client.query('INSERT INTO app_images (image_data) VALUES ($1) RETURNING id', [req.file.buffer]);
      item.icon_url = `/uploads/${image.rows[0].id}`;
    }
    if (id) {
      await client.query(`UPDATE applications SET slug=$1,name=$2,subtitle=$3,description=$4,icon_url=$5,download_url=$6,button_label=$7,size_text=$8,platform=$9,details=$10,display_order=$11,is_active=$12,updated_at=NOW() WHERE id=$13`, [item.slug,item.name,item.subtitle,item.description,item.icon_url,item.download_url,item.button_label,item.size_text,item.platform,item.details,item.display_order,item.is_active,id]);
    } else {
      await client.query(`INSERT INTO applications (slug,name,subtitle,description,icon_url,download_url,button_label,size_text,platform,details,display_order,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [item.slug,item.name,item.subtitle,item.description,item.icon_url,item.download_url,item.button_label,item.size_text,item.platform,item.details,item.display_order,item.is_active]);
    }
    await client.query('COMMIT');
    res.redirect('/admin');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(400).type('html').send(adminFormPage(req, { ...item, id: id || '' }, 'Esse identificador já está em uso. Escolha outro slug.'));
    next(error);
  } finally {
    if (client) client.release();
  }
});

app.post('/admin/apps/import', requireAdmin, requireCsrf, async (req, res, next) => {
  let input;
  try {
    input = JSON.parse(String(req.body.appsJson || ''));
  } catch (_) {
    return res.status(400).type('html').send(pageShell('Importação inválida', '<main class="admin-wrap"><section class="panel"><h1>JSON inválido</h1><p>Confira o conteúdo e tente novamente.</p><a class="button" href="/admin">Voltar</a></section></main>'));
  }
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    return res.status(400).type('html').send(pageShell('Importação inválida', '<main class="admin-wrap"><section class="panel"><h1>Lista inválida</h1><p>O JSON precisa conter entre 1 e 100 aplicativos.</p><a class="button" href="/admin">Voltar</a></section></main>'));
  }
  const appsToImport = [];
  for (const row of input) {
    const validated = validateAppInput(row || {});
    if (validated.error) {
      return res.status(400).type('html').send(pageShell('Importação inválida', `<main class="admin-wrap"><section class="panel"><h1>Não foi possível importar</h1><p>${escapeHtml(validated.error)}</p><a class="button" href="/admin">Voltar</a></section></main>`));
    }
    appsToImport.push(validated.appData);
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    for (const item of appsToImport) {
      await client.query(`INSERT INTO applications (slug,name,subtitle,description,icon_url,download_url,button_label,size_text,platform,details,display_order,is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name,subtitle=EXCLUDED.subtitle,description=EXCLUDED.description,icon_url=EXCLUDED.icon_url,download_url=EXCLUDED.download_url,button_label=EXCLUDED.button_label,size_text=EXCLUDED.size_text,platform=EXCLUDED.platform,details=EXCLUDED.details,display_order=EXCLUDED.display_order,is_active=EXCLUDED.is_active,updated_at=NOW()`, [item.slug,item.name,item.subtitle,item.description,item.icon_url,item.download_url,item.button_label,item.size_text,item.platform,item.details,item.display_order,item.is_active]);
    }
    await client.query('COMMIT');
    res.redirect(`/admin?imported=${appsToImport.length}`);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    if (client) client.release();
  }
});

app.post('/admin/apps/:id/remove-icon', requireAdmin, requireCsrf, async (req, res, next) => {
  const appId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(appId) || appId < 1) return res.status(404).end();
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query('SELECT icon_url FROM applications WHERE id=$1 FOR UPDATE', [appId]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).send('Aplicativo não encontrado.');
    }
    const previousIcon = String(result.rows[0].icon_url || '');
    await client.query("UPDATE applications SET icon_url='', updated_at=NOW() WHERE id=$1", [appId]);
    const match = previousIcon.match(/^\/uploads\/(\d+)$/);
    if (match) {
      await client.query(`DELETE FROM app_images WHERE id=$1 AND NOT EXISTS (
        SELECT 1 FROM applications WHERE icon_url=$2
      )`, [match[1], `/uploads/${match[1]}`]);
    }
    await client.query('COMMIT');
    res.redirect(`/admin/apps/${appId}/edit?iconRemoved=1`);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    if (client) client.release();
  }
});

app.post('/admin/apps/:id/delete', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM applications WHERE id = $1', [req.params.id]);
    res.redirect('/admin');
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).type('html').send(pageShell('Página não encontrada', '<main class="admin-wrap"><section class="panel"><h1>Página não encontrada</h1><a class="button" href="/">Voltar ao catálogo</a></section></main>'));
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).type('html').send(pageShell('Erro interno', '<main class="admin-wrap"><section class="panel"><h1>Não foi possível concluir</h1><p>Tente novamente mais tarde.</p><a class="button" href="/">Voltar ao catálogo</a></section></main>'));
});

async function initializeDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS applications (
    id BIGSERIAL PRIMARY KEY,
    slug VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    subtitle VARCHAR(180) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    icon_url VARCHAR(500) NOT NULL,
    download_url TEXT NOT NULL DEFAULT '',
    button_label VARCHAR(80) NOT NULL DEFAULT 'Abrir download',
    size_text VARCHAR(80) NOT NULL DEFAULT '',
    platform VARCHAR(180) NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_images (
    id BIGSERIAL PRIMARY KEY,
    image_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS site_branding (
    id SMALLINT PRIMARY KEY CHECK (id=1),
    logo_png BYTEA,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('INSERT INTO site_branding (id, logo_png) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING');
  const count = await pool.query('SELECT COUNT(*)::int AS total FROM applications');
  if (count.rows[0].total === 0) {
    for (const item of seedApps) {
      await pool.query(`INSERT INTO applications (slug,name,subtitle,description,icon_url,download_url,button_label,size_text,platform,details,display_order,is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (slug) DO NOTHING`, [item.slug,item.name,item.subtitle,item.description,item.icon_url,item.download_url,item.button_label,item.size_text,item.platform,item.details,item.display_order,item.is_active]);
    }
    console.log(`Seeded ${seedApps.length} applications.`);
  }
}

initializeDatabase()
  .then(() => app.listen(port, () => console.log(`FLASHX catalog listening on port ${port}`)))
  .catch((error) => {
    console.error('Database initialization failed:', error.message);
    process.exit(1);
  });
