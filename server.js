const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Cache simples em memória (evita bater no site a cada requisição)
const cache = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// Mapa de Bichos por grupo
const BICHOS = [
  '', 'Avestruz', 'Águia', 'Burro', 'Borboleta', 'Cachorro',
  'Cabra', 'Carneiro', 'Camelo', 'Cobra', 'Coelho',
  'Cavalo', 'Elefante', 'Galo', 'Gato', 'Jacaré',
  'Leão', 'Macaco', 'Porco', 'Pavão', 'Peru',
  'Touro', 'Tigre', 'Urso', 'Veado', 'Vaca'
];

function calcularBicho(milhar) {
  const n = parseInt(milhar) % 100 || 100;
  const grupo = Math.ceil(n / 4);
  return { grupo: grupo.toString().padStart(2, '0'), bicho: BICHOS[grupo] || '?' };
}

// Fuso Brasília
function getHoraBrasilia() {
  const agora = new Date();
  const brasilia = new Date(agora.getTime() - (3 * 60 * 60 * 1000));
  return brasilia.getUTCHours() * 60 + brasilia.getUTCMinutes();
}

function getDataBrasilia() {
  const agora = new Date();
  const brasilia = new Date(agora.getTime() - (3 * 60 * 60 * 1000));
  const y = brasilia.getUTCFullYear();
  const m = String(brasilia.getUTCMonth() + 1).padStart(2, '0');
  const d = String(brasilia.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getLaunchOptions() {
  // Em produção (Railway/Render) usa o Chromium do pacote @sparticuz/chromium
  // Em desenvolvimento local usa o Chrome instalado
  if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
    const chromium = require('@sparticuz/chromium');
    return {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    };
  } else {
    // Desenvolvimento local: tenta achar o Chrome instalado
    return {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath: process.env.CHROME_PATH || undefined,
    };
  }
}

async function scrapeResultados(slug, dataParam) {
  // Se vier uma data específica, usamos ela; se não, usamos hoje (Brasília)
  const dataAlvo = dataParam || getDataBrasilia();
  const ehHoje = dataAlvo === getDataBrasilia();

  // Verifica cache (apenas para o dia de hoje)
  const cacheKey = `${slug}-${dataAlvo}`;
  if (ehHoje && cache[cacheKey] && (Date.now() - cache[cacheKey].timestamp < CACHE_TTL_MS)) {
    console.log(`[CACHE HIT] ${slug} ${dataAlvo}`);
    return cache[cacheKey].data;
  }

  // Mapa completo de todas as loterias disponíveis no Resultado Fácil
  const MAPA_LOTERIAS = {
    'look-goias':        { url: 'resultados-look-loterias-de-hoje',      urlHist: 'resultados-look-loterias-do-dia',        horarios: ['07:00','09:00','11:00','14:00','16:00','18:00','21:00','23:00'] },
    'loteria-nacional':  { url: 'resultados-da-banca-loteria-nacional',  urlHist: 'resultados-loteria-nacional-do-dia',    horarios: ['02:00','08:00','10:00','12:00','15:00','17:00','19:00','22:00'] },
    'lotep':             { url: 'resultados-lotep-de-hoje',              urlHist: 'resultados-lotep-do-dia',               horarios: ['10:45','12:45','15:45','18:00'] },
    'pt-rio':            { url: 'resultados-pt-rio-de-hoje',             urlHist: 'resultados-pt-rio-do-dia',              horarios: ['09:20','11:20','14:20','16:20','18:20','21:20'] },
    'minas-mg':          { url: 'resultado-do-jogo-do-bicho/mg',         urlHist: 'resultados-minas-gerais-do-dia',        horarios: ['12:00','15:00','19:00','21:00'] },
    'loteria-do-parana': { url: 'resultado-do-jogo-do-bicho/pr',         urlHist: 'resultados-parana-do-dia',              horarios: ['10:00','11:00','14:00','16:00','18:00','21:00'] },
    'federal':           { url: 'ultimos-resultados-da-federal-1ao10',   urlHist: 'resultados-federal-do-dia',             horarios: ['19:00'] },
  };


  const lotConfig = MAPA_LOTERIAS[slug];
  if (!lotConfig) {
    throw new Error('Slug desconhecido: ' + slug);
  }

  const BASE = 'https://www.resultadofacil.com.br/';
  const urlSite  = ehHoje
    ? BASE + lotConfig.url
    : BASE + lotConfig.urlHist + '-' + dataAlvo;
  const horarios = lotConfig.horarios;


  const puppeteer = require('puppeteer-core');
  const launchOptions = await getLaunchOptions();
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();

    // Simula um navegador humano real
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    console.log(`[SCRAPER] Acessando: ${urlSite}`);
    await page.goto(urlSite, { waitUntil: 'networkidle2', timeout: 30000 });

    // Tenta clicar no botão "1º ao 10º" se existir
    try {
      const btn10 = await page.$('a[href*="1ao10"], a[href*="1-ao-10"], img[alt*="10"]');
      if (btn10) {
        console.log('[SCRAPER] Clicando no botão 1º ao 10º...');
        await btn10.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
      }
    } catch (e) {
      console.log('[SCRAPER] Botão 1-10 não encontrado, continuando...');
    }

    // Extrai os dados da página
    // Para dias passados, todos os horários são válidos (o sorteio já ocorreu)
    const tempoLimite = ehHoje ? getHoraBrasilia() : 24 * 60;

    const draws = await page.evaluate((horarios, tempoLimite) => {
      const resultado = [];

      // Procura todos os blocos de resultado (organizados por horário)
      // O site usa h2, h3 ou divs com o horário
      const todosElementos = document.querySelectorAll('h2, h3, h4, .resultado-titulo, [class*="hora"], [class*="horario"]');

      for (const el of todosElementos) {
        const texto = el.textContent || '';
        // Procura padrão de hora: "07h", "07:00", "07h00"
        const matchHora = texto.match(/\b(\d{1,2})h(?:00)?\b|\b(\d{1,2}):00\b/);
        if (!matchHora) continue;

        const hora = parseInt(matchHora[1] || matchHora[2]);
        const horaFormatada = hora.toString().padStart(2, '0') + ':00';
        const tempoSorteio = hora * 60;
        if (tempoSorteio > tempoLimite) continue; // Sorteio ainda não ocorreu

        // Pega a tabela/bloco mais próximo após este título
        let proximo = el.nextElementSibling;
        let tabelaEncontrada = null;
        let tentativas = 0;

        while (proximo && tentativas < 10) {
          if (proximo.tagName === 'TABLE') {
            tabelaEncontrada = proximo;
            break;
          }
          const tabelaInterna = proximo.querySelector('table');
          if (tabelaInterna) {
            tabelaEncontrada = tabelaInterna;
            break;
          }
          proximo = proximo.nextElementSibling;
          tentativas++;
        }

        if (!tabelaEncontrada) continue;

        // Extrai as linhas da tabela
        const linhas = tabelaEncontrada.querySelectorAll('tr');
        const premios = [];

        for (const linha of linhas) {
          const celulas = linha.querySelectorAll('td');
          if (celulas.length < 2) continue;

          // Procura uma célula com milhar (4 dígitos)
          let milhar = '';
          let posicaoMilhar = -1;

          for (let i = 0; i < celulas.length; i++) {
            const val = celulas[i].textContent.trim();
            if (/^\d{4}$/.test(val)) {
              milhar = val;
              posicaoMilhar = i;
              break;
            }
          }

          if (!milhar) continue;

          const premioPosicao = posicaoMilhar > 0 ? celulas[posicaoMilhar - 1].textContent.trim() : (premios.length + 1) + 'º';
          const grupo = posicaoMilhar + 1 < celulas.length ? celulas[posicaoMilhar + 1].textContent.trim() : '';
          const bicho = posicaoMilhar + 2 < celulas.length ? celulas[posicaoMilhar + 2].textContent.trim() : '';

          premios.push({ milhar, grupo, bicho, label: premioPosicao });

          if (premios.length >= 10) break;
        }

        if (premios.length > 0) {
          resultado.push({ horario: horaFormatada, premios });
        }
      }

      return resultado;
    }, horarios, tempoLimite);

    // Formata para o padrão do PWA
    const drawsFormatados = draws.map(d => ({
      horario: d.horario,
      data: dataAlvo,
      resultados: d.premios.map((p, idx) => {
        const info = calcularBicho(p.milhar);
        return {
          premio: (idx + 1) + 'º',
          milhar: p.milhar,
          grupo: p.grupo || info.grupo,
          bicho: p.bicho || info.bicho
        };
      })
    }));

    const resposta = { loteria: slug.toUpperCase(), data: dataAlvo, draws: drawsFormatados };

    // Salva no cache (apenas hoje)
    if (ehHoje) {
      cache[cacheKey] = { data: resposta, timestamp: Date.now() };
    }

    console.log(`[SCRAPER] Sucesso! ${drawsFormatados.length} sorteios encontrados para ${slug}`);
    return resposta;

  } finally {
    await browser.close();
  }
}

// ==========================================
// ROTAS DA API
// ==========================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rota principal de resultados
app.get('/', async (req, res) => {
  const slug = req.query.slug || 'look-goias';
  // Suporte a data: ?data=2026-04-22 (formato YYYY-MM-DD)
  const data = req.query.data || null;

  try {
    console.log(`[REQUEST] slug=${slug} data=${data || 'hoje'}`);
    const dados = await scrapeResultados(slug, data);
    res.json(dados);
  } catch (err) {
    console.error('[ERRO]', err.message);
    res.json({ error: err.message, slug });
  }
});

// Limpar cache manualmente (útil para forçar atualização)
app.get('/clear-cache', (req, res) => {
  Object.keys(cache).forEach(k => delete cache[k]);
  res.json({ ok: true, message: 'Cache limpo!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Radar Server rodando na porta ${PORT}`);
  console.log(`   Teste: http://localhost:${PORT}/?slug=look-goias`);
});
