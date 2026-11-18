import { db } from 'hatchable';
import { haversineMeters, boundingBox } from './geo.js';

// zasieg masztu jak w danych nie ma range_m
const DEFAULT_RANGE = { GSM: 8000, UMTS: 3000, LTE: 2000, NR: 1200 };

// gorny limit, bo w OpenCellID zdarza sie range_m po 50 km
// i wtedy LTE z 10 km wychodzilo jako swietny zasieg
const MAX_RANGE = { GSM: 15000, UMTS: 6000, LTE: 4000, NR: 1500 };

// to jest mapa zasiegu internetu, wiec 2G liczy sie malo,
// nawet jak fizycznie siega dalej niz LTE
const INTERNET_WEIGHT = { GSM: 0.25, UMTS: 0.6, LTE: 1.0, NR: 1.3 };

const SEARCH_RADIUS_M = 40000;
const TOWERS_PER_OPERATOR = 5;
const LOW_SAMPLES = 3;

// zgloszenia uzytkownikow z okolo 800 m i ostatnich 90 dni
const REPORT_DLAT = 0.0072;
const REPORT_DLON = 0.0115; // ~800 m na szerokosci Polski
const MIN_REPORTS = 3;

const LEVELS = ['brak zasięgu', 'słaby', 'średni', 'dobry', 'świetny'];

function levelFromScore(score) {
  if (score <= 0) return 0;
  if (score < 0.4) return 1;
  if (score < 0.8) return 2;
  if (score < 1.3) return 3;
  return 4;
}

function effectiveRange(radio, rangeM, samples) {
  let range = rangeM > 0 ? Math.min(rangeM, MAX_RANGE[radio] ?? 4000) : DEFAULT_RANGE[radio] ?? 2000;
  if (samples != null && samples < LOW_SAMPLES) range *= 0.6; // malo pomiarow = mniej ufam
  return range;
}

// 1.0 = punkt dokladnie na granicy zasiegu, wiecej = blizej masztu
function towerScore(t) {
  return (t.range / Math.max(t.distance, 50)) * (INTERNET_WEIGHT[t.radio] ?? 0.8);
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

async function crowdLevel(operatorId, lat, lon) {
  const { rows } = await db.query(
    `SELECT signal_bars FROM signal_reports
     WHERE operator_id = $1
       AND created_at > now() - interval '90 days'
       AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
    [operatorId, lat - REPORT_DLAT, lat + REPORT_DLAT, lon - REPORT_DLON, lon + REPORT_DLON]
  );
  if (rows.length < MIN_REPORTS) return null;
  return { level: median(rows.map((r) => r.signal_bars)), count: rows.length };
}

// zasieg w punkcie dla kazdego polskiego operatora:
// maszty z OpenCellID + oficjalne z UKE, a jak w okolicy sa
// zgloszenia od ludzi, to one wygrywaja z wyliczeniem
export async function estimateCoverage(lat, lon) {
  const box = boundingBox(lat, lon, SEARCH_RADIUS_M);
  const { rows: operators } = await db.query('SELECT id, mnc, name, color FROM operators');

  const { rows: towers } = await db.query(
    `SELECT mnc, radio, lat, lon, range_m, samples FROM cell_towers
     WHERE mcc = 260 AND lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4`,
    [box.minLat, box.maxLat, box.minLon, box.maxLon]
  );
  const { rows: ukeTowers } = await db.query(
    `SELECT operator_id, radio, lat, lon FROM uke_towers
     WHERE lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4`,
    [box.minLat, box.maxLat, box.minLon, box.maxLon]
  );

  const results = [];

  for (const op of operators) {
    const near = [];

    for (const t of towers) {
      if (t.mnc !== op.mnc) continue;
      const distance = haversineMeters(lat, lon, t.lat, t.lon);
      if (distance > SEARCH_RADIUS_M) continue;
      near.push({ distance, radio: t.radio, range: effectiveRange(t.radio, t.range_m, t.samples), uke: false });
    }
    for (const t of ukeTowers) {
      if (t.operator_id !== op.id) continue;
      const distance = haversineMeters(lat, lon, t.lat, t.lon);
      if (distance > SEARCH_RADIUS_M) continue;
      near.push({ distance, radio: t.radio, range: effectiveRange(t.radio, null, LOW_SAMPLES), uke: true });
    }

    if (near.length === 0) continue;

    near.sort((a, b) => a.distance - b.distance);
    const closest = near.slice(0, TOWERS_PER_OPERATOR);
    const best = closest.reduce((a, b) => (towerScore(b) > towerScore(a) ? b : a));
    // troche bonusu za gestosc masztow
    const score = towerScore(best) + Math.min(closest.length / TOWERS_PER_OPERATOR, 1) * 0.15;

    let level = levelFromScore(score);
    let source = best.uke ? 'uke' : 'opencellid';

    const crowd = await crowdLevel(op.id, lat, lon);
    if (crowd) {
      level = crowd.level;
      source = 'zgloszenia';
    }

    results.push({
      operator: op.name,
      color: op.color,
      level,
      label: LEVELS[level],
      technology: best.radio,
      nearestTowerM: Math.round(best.distance),
      reports: crowd?.count ?? 0,
      source,
    });
  }

  return results.sort((a, b) => b.level - a.level);
}
