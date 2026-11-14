// Draws the profile "On GitHub lately" cards from public GitHub data.
// ASCII-only SVG so GitHub can render the image.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const login = process.env.STATS_LOGIN || "Mrehankamboh";
const outDir = process.env.STATS_OUT || fileURLToPath(new URL("../stats-out/", import.meta.url));
const token = process.env.GITHUB_TOKEN || "";

if (!token) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const query = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount date } }
      }
    }
    ownedRepos: repositories(first: 100, privacy: PUBLIC, ownerAffiliations: OWNER, isFork: false) {
      nodes {
        languages(first: 8, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
  }
}
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${token}`,
    "User-Agent": "Mrehankamboh-profile-stats",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query, variables: { login } }),
});

if (!response.ok) {
  console.error(`GitHub API ${response.status}`);
  process.exit(1);
}

const payload = await response.json();
if (payload.errors) {
  console.error(payload.errors.map((error) => error.message).join("\n"));
  process.exit(1);
}

const user = payload.data.user;
const weeks = user.contributionsCollection.contributionCalendar.weeks;
const days = weeks.flatMap((week) => week.contributionDays);
const total = user.contributionsCollection.contributionCalendar.totalContributions;

const profileResponse = await fetch(`https://api.github.com/users/${login}`, {
  headers: {
    Authorization: `bearer ${token}`,
    "User-Agent": "Mrehankamboh-profile-stats",
  },
});
if (!profileResponse.ok) {
  console.error(`GitHub user API ${profileResponse.status}`);
  process.exit(1);
}
const profile = await profileResponse.json();
const publicRepos = profile.public_repos;

const today = new Date().toISOString().slice(0, 10);
let todayIndex = days.findIndex((day) => day.date === today);
if (todayIndex < 0) todayIndex = days.length - 1;

function streakAt(index) {
  let count = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (days[i].contributionCount > 0) count += 1;
    else break;
  }
  return count;
}

let current = days[todayIndex].contributionCount > 0
  ? streakAt(todayIndex)
  : (todayIndex > 0 ? streakAt(todayIndex - 1) : 0);

let longest = 0;
let run = 0;
for (const day of days) {
  if (day.contributionCount > 0) {
    run += 1;
    if (run > longest) longest = run;
  } else {
    run = 0;
  }
}

const languages = new Map();
for (const repo of user.ownedRepos.nodes) {
  for (const edge of repo.languages.edges) {
    const name = ascii(edge.node.name);
    if (!name) continue;
    languages.set(name, (languages.get(name) || 0) + edge.size);
  }
}
const ranked = [...languages.entries()].sort((a, b) => b[1] - a[1]);
const top = ranked.slice(0, 4);
const other = ranked.slice(4).reduce((sum, entry) => sum + entry[1], 0);
if (other > 0) top.push(["Other", other]);
const languageTotal = top.reduce((sum, entry) => sum + entry[1], 0) || 1;

const stats = {
  total,
  current,
  longest,
  publicRepos,
  weeks: weeks.slice(-53),
  languages: top.map(([name, size]) => ({
    name,
    share: size / languageTotal,
  })),
  updated: today,
};

const light = {
  bg: "#F7F9FB",
  stroke: "#DDE3EA",
  text: "#0B1220",
  muted: "#667085",
  accent: "#0A7A50",
  cells: ["#E6EBF0", "#B7E7CF", "#5EBE8A", "#0A7A50", "#064E34"],
  bars: ["#0A7A50", "#127A9A", "#475467", "#C4A35A", "#C5D0DC"],
};

const dark = {
  bg: "#0B1220",
  stroke: "#2A3A50",
  text: "#F7F9FB",
  muted: "#8B9AAB",
  accent: "#34D399",
  cells: ["#161E2A", "#0E4429", "#006D32", "#26A641", "#39D353"],
  bars: ["#34D399", "#7DD3FC", "#C5D0DC", "#F5D38A", "#2A3A50"],
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "stats-light.svg"), card(stats, light), "utf8");
await writeFile(join(outDir, "stats-dark.svg"), card(stats, dark), "utf8");
console.log(`wrote cards for ${login}: ${total} contributions, streak ${current}`);

function ascii(value) {
  return String(value).replace(/[^\x20-\x7E]/g, "");
}

function xml(value) {
  return ascii(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function commas(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function daysLabel(value) {
  return value === 1 ? "1 day" : `${value} days`;
}

function level(count) {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

function card(data, theme) {
  const cell = 11;
  const gap = 3;
  const heatX = 500;
  const heatY = 58;
  const cells = data.weeks.map((week, column) => week.contributionDays.map((day, row) => {
    const x = heatX + column * (cell + gap);
    const y = heatY + row * (cell + gap);
    const fill = theme.cells[level(day.contributionCount)];
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}"/>`;
  }).join("")).join("");

  let barX = 500;
  const barY = 176;
  const barW = 740;
  const bars = data.languages.map((language, index) => {
    const width = Math.max(2, Math.round(language.share * barW));
    const x = barX;
    barX += width;
    return `<rect x="${x}" y="${barY}" width="${width}" height="14" fill="${theme.bars[index % theme.bars.length]}"/>`;
  }).join("");

  const labels = `<text x="500" y="210" fill="${theme.muted}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12">${data.languages.map((language) => `${xml(language.name)} ${Math.round(language.share * 100)}%`).join("   ")}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="248" viewBox="0 0 1280 248" role="img" aria-label="GitHub activity over the last 12 months.">
  <title>On GitHub lately. ${commas(data.total)} contributions. Current streak ${daysLabel(data.current)}. Longest streak ${daysLabel(data.longest)}. ${data.publicRepos} public repos. Updated ${data.updated}.</title>
  <rect width="1280" height="248" rx="20" fill="${theme.bg}" stroke="${theme.stroke}"/>
  <text x="36" y="40" fill="${theme.accent}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" font-weight="700">LAST 12 MONTHS ON GITHUB</text>
  <text x="1244" y="40" text-anchor="end" fill="${theme.muted}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13">updated ${data.updated}</text>
  <text x="36" y="96" fill="${theme.text}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="40" font-weight="700">${commas(data.total)}</text>
  <text x="36" y="118" fill="${theme.muted}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" font-weight="700">CONTRIBUTIONS</text>
  <text x="250" y="96" fill="${theme.text}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="40" font-weight="700">${daysLabel(data.current)}</text>
  <text x="250" y="118" fill="${theme.muted}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" font-weight="700">CURRENT STREAK</text>
  <text x="36" y="176" fill="${theme.text}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="28" font-weight="700">${daysLabel(data.longest)}</text>
  <text x="36" y="198" fill="${theme.muted}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" font-weight="700">LONGEST STREAK</text>
  <text x="250" y="176" fill="${theme.text}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="28" font-weight="700">${data.publicRepos}</text>
  <text x="250" y="198" fill="${theme.muted}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" font-weight="700">PUBLIC REPOS</text>
  ${cells}
  ${bars}
  ${labels}
</svg>
`;
}

