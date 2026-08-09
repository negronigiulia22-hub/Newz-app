// Script che gira automaticamente su GitHub Actions.
// Scarica le notizie dalle fonti, estrae il testo completo di ogni articolo,
// lo fa riassumere dall'AI in circa 2 minuti di lettura, e salva tutto in news.json.

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import fs from 'fs';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const SOURCES = [
  { cat: 'politica',  name: 'Il Post',  feed: 'https://www.ilpost.it/politica/feed/' },
  { cat: 'mondo',     name: 'Il Post',  feed: 'https://www.ilpost.it/mondo/feed/' },
  { cat: 'sport',     name: 'Il Post',  feed: 'https://www.ilpost.it/sport/feed/' },
  { cat: 'scienza',   name: 'Focus.it', feed: 'https://www.focus.it/rss/scienza.rss' },
  { cat: 'storia',    name: 'Focus.it', feed: 'https://www.focus.it/rss/cultura.rss' },
  { cat: 'tech',      name: 'Focus.it', feed: 'https://www.focus.it/rss/tecnologia.rss' }
];

const ITEMS_PER_SOURCE = 4;

function extractTag(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>'));
  if (!m) return '';
  return m[1].replace('<![CDATA[', '').replace(']]>', '').trim();
}

function parseRss(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const raw of blocks) {
    const block = raw.split('</item>')[0];
    items.push({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link'),
      description: extractTag(block, 'description')
    });
  }
  return items;
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*'
    }
  });
  const text = await res.text();
  console.log('  fetch', url, '-> status', res.status, '- lunghezza', text.length);
  return text;
}

async function extractArticle(url) {
  try {
    const html = await fetchText(url);
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (article && article.textContent && article.textContent.trim().length > 200) {
      return article.textContent.trim();
    }
  } catch (e) {
    console.log('Estrazione fallita per', url, e.message);
  }
  return null;
}

const MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

async function callGemini(model, prompt) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error('status ' + res.status + ' ' + JSON.stringify(data).slice(0, 200));
    err.status = res.status;
    throw err;
  }
  const out = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0].text;
  if (!out) throw new Error('risposta AI vuota');
  return out.trim();
}

async function summarize(title, text) {
  if (!GEMINI_API_KEY) {
    console.log('  -> salto riassunto AI: il secret GEMINI_API_KEY non è arrivato allo script');
    return null;
  }
  const prompt = 'Riassumi il seguente articolo giornalistico in italiano, in modo chiaro, neutrale e scorrevole, in circa 280-320 parole (lettura di circa 2 minuti). Usa SOLO le informazioni presenti nel testo: non inventare fatti, nomi o numeri assenti. Nessuna opinione personale. Scrivi solo il riassunto, senza titoli o introduzioni.\n\nTitolo: ' + title + '\n\nTesto:\n' + text.slice(0, 8000);

  for (const model of MODELS) {
    try {
      const summary = await callGemini(model, prompt);
      console.log('  -> riassunto AI ok con modello', model);
      return summary;
    } catch (e) {
      console.log('  -> modello', model, 'fallito:', e.message);
    }
  }
  return null;
}

async function run() {
  console.log('Chiave AI configurata:', GEMINI_API_KEY ? ('sì, lunghezza ' + GEMINI_API_KEY.length) : 'NO - il secret GEMINI_API_KEY è vuoto o non arriva');
  const allNews = [];
  for (const src of SOURCES) {
    try {
      const xml = await fetchText(src.feed);
      const items = parseRss(xml).slice(0, ITEMS_PER_SOURCE);
      for (const item of items) {
        const shortDesc = stripHtml(item.description);
        let fullSummary = shortDesc || item.title;
        const articleText = await extractArticle(item.link);
        if (articleText) {
          const aiSummary = await summarize(item.title, articleText);
          if (aiSummary) fullSummary = aiSummary;
          await new Promise(r => setTimeout(r, 5000));
        }
        allNews.push({
          cat: src.cat,
          title: stripHtml(item.title),
          summary: shortDesc.slice(0, 140) + (shortDesc.length > 140 ? '…' : ''),
          fullSummary,
          source: src.name,
          url: item.link
        });
      }
      console.log('OK', src.cat, '-', items.length, 'articoli');
    } catch (e) {
      console.log('Fonte fallita', src.cat, e.message);
    }
  }
  fs.writeFileSync('news.json', JSON.stringify({ generatedAt: new Date().toISOString(), items: allNews }, null, 2));
  console.log('Scritte', allNews.length, 'notizie in news.json');
}

run();
