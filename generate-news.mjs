// Script che gira automaticamente su GitHub Actions.
// Scarica solo i titoli e le anteprime dalle fonti e le salva in news.json.
// Il riassunto AI da 2 minuti viene generato direttamente nell'app quando l'utente
// tocca "Leggi il riassunto" (vedi index.html) - niente più chiavi o modelli qui.

import fs from 'fs';

const SOURCES = [
  { cat: 'politica',  name: 'Il Post',  feed: 'https://www.ilpost.it/politica/feed/' },
  { cat: 'mondo',     name: 'Il Post',  feed: 'https://www.ilpost.it/mondo/feed/' },
  { cat: 'sport',     name: 'Il Post',  feed: 'https://www.ilpost.it/sport/feed/' },
  { cat: 'scienza',   name: 'Focus.it', feed: 'https://www.focus.it/rss/scienza.rss' },
  { cat: 'storia',    name: 'Focus.it', feed: 'https://www.focus.it/rss/cultura.rss' },
  { cat: 'tech',      name: 'Focus.it', feed: 'https://www.focus.it/rss/tecnologia.rss' }
];

const ITEMS_PER_SOURCE = 6;

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

async function run() {
  const allNews = [];
  for (const src of SOURCES) {
    try {
      const xml = await fetchText(src.feed);
      const items = parseRss(xml).slice(0, ITEMS_PER_SOURCE);
      for (const item of items) {
        const shortDesc = stripHtml(item.description);
        allNews.push({
          cat: src.cat,
          title: stripHtml(item.title),
          summary: shortDesc.slice(0, 140) + (shortDesc.length > 140 ? '…' : ''),
          fullSummary: shortDesc || item.title,
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
