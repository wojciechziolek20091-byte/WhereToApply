// Data sources:
// - Universities: QS World University Rankings 2026, official results (qs.com / topuniversities.com/world-university-rankings/2026)
// - Social science fields: common discipline classifications from higher-ed sources
//   (Michigan State University College of Social Science; BestColleges; Coursera "Social Science Majors")
//   and NCES Fast Facts (nces.ed.gov/fastfacts/display.asp?id=37) for the combined
//   "Social sciences & history" undergraduate degree share.

const universities = [
  { rank: 1, name: "Massachusetts Institute of Technology (MIT)", country: "United States", site: "https://web.mit.edu" },
  { rank: 2, name: "Imperial College London", country: "United Kingdom", site: "https://www.imperial.ac.uk" },
  { rank: 3, name: "Stanford University", country: "United States", site: "https://www.stanford.edu" },
  { rank: 4, name: "University of Oxford", country: "United Kingdom", site: "https://www.ox.ac.uk" },
  { rank: 5, name: "Harvard University", country: "United States", site: "https://www.harvard.edu" },
  { rank: 6, name: "University of Cambridge", country: "United Kingdom", site: "https://www.cam.ac.uk" },
  { rank: 7, name: "ETH Zurich (Swiss Federal Institute of Technology)", country: "Switzerland", site: "https://ethz.ch" },
  { rank: 8, name: "National University of Singapore (NUS)", country: "Singapore", site: "https://www.nus.edu.sg" },
  { rank: 9, name: "UCL (University College London)", country: "United Kingdom", site: "https://www.ucl.ac.uk" },
  { rank: 10, name: "California Institute of Technology (Caltech)", country: "United States", site: "https://www.caltech.edu" },
  { rank: 11, name: "The University of Hong Kong", country: "Hong Kong", site: "https://www.hku.hk" },
  { rank: 12, name: "Nanyang Technological University, Singapore (NTU Singapore)", country: "Singapore", site: "https://www.ntu.edu.sg" },
  { rank: 13, name: "University of Chicago", country: "United States", site: "https://www.uchicago.edu" },
  { rank: 14, name: "Peking University", country: "China", site: "https://www.pku.edu.cn" },
  { rank: 15, name: "University of Pennsylvania", country: "United States", site: "https://www.upenn.edu" },
  { rank: 16, name: "Cornell University", country: "United States", site: "https://www.cornell.edu" },
  { rank: 17, name: "Tsinghua University", country: "China", site: "https://www.tsinghua.edu.cn" },
  { rank: 17, name: "University of California, Berkeley (UCB)", country: "United States", site: "https://www.berkeley.edu" },
  { rank: 19, name: "The University of Melbourne", country: "Australia", site: "https://www.unimelb.edu.au" },
  { rank: 20, name: "The University of New South Wales", country: "Australia", site: "https://www.unsw.edu.au" },
  { rank: 21, name: "Yale University", country: "United States", site: "https://www.yale.edu" },
  { rank: 22, name: "École Polytechnique Fédérale de Lausanne", country: "Switzerland", site: "https://www.epfl.ch" },
  { rank: 22, name: "Technical University of Munich", country: "Germany", site: "https://www.tum.de" },
  { rank: 24, name: "Johns Hopkins University", country: "United States", site: "https://www.jhu.edu" },
  { rank: 25, name: "Princeton University", country: "United States", site: "https://www.princeton.edu" },
  { rank: 25, name: "The University of Sydney", country: "Australia", site: "https://www.sydney.edu.au" },
  { rank: 27, name: "McGill University", country: "Canada", site: "https://www.mcgill.ca" },
  { rank: 28, name: "PSL University", country: "France", site: "https://psl.eu" },
  { rank: 29, name: "University of Toronto", country: "Canada", site: "https://www.utoronto.ca" },
  { rank: 30, name: "Fudan University", country: "China", site: "https://www.fudan.edu.cn" },
  { rank: 31, name: "King's College London (KCL)", country: "United Kingdom", site: "https://www.kcl.ac.uk" },
  { rank: 32, name: "Australian National University", country: "Australia", site: "https://www.anu.edu.au" },
  { rank: 32, name: "The Chinese University of Hong Kong", country: "Hong Kong", site: "https://www.cuhk.edu.hk" },
  { rank: 34, name: "University of Edinburgh", country: "United Kingdom", site: "https://www.ed.ac.uk" },
  { rank: 35, name: "The University of Manchester", country: "United Kingdom", site: "https://www.manchester.ac.uk" },
  { rank: 36, name: "Monash University", country: "Australia", site: "https://www.monash.edu" },
  { rank: 36, name: "The University of Tokyo", country: "Japan", site: "https://www.u-tokyo.ac.jp" },
  { rank: 38, name: "Columbia University", country: "United States", site: "https://www.columbia.edu" },
  { rank: 38, name: "Seoul National University", country: "South Korea", site: "https://www.snu.ac.kr" },
  { rank: 40, name: "University of British Columbia", country: "Canada", site: "https://www.ubc.ca" },
  { rank: 41, name: "Institut Polytechnique de Paris", country: "France", site: "https://www.ip-paris.fr" },
  { rank: 42, name: "Northwestern University", country: "United States", site: "https://www.northwestern.edu" },
  { rank: 42, name: "The University of Queensland", country: "Australia", site: "https://www.uq.edu.au" },
  { rank: 44, name: "The Hong Kong University of Science and Technology", country: "Hong Kong", site: "https://www.ust.hk" },
  { rank: 45, name: "University of Michigan-Ann Arbor", country: "United States", site: "https://www.umich.edu" },
  { rank: 46, name: "University of California, Los Angeles (UCLA)", country: "United States", site: "https://www.ucla.edu" },
  { rank: 47, name: "Delft University of Technology", country: "Netherlands", site: "https://www.tudelft.nl" },
  { rank: 47, name: "Shanghai Jiao Tong University", country: "China", site: "https://www.sjtu.edu.cn" },
  { rank: 49, name: "Zhejiang University", country: "China", site: "https://www.zju.edu.cn" },
  { rank: 50, name: "Yonsei University", country: "South Korea", site: "https://www.yonsei.ac.kr" },
  { rank: 51, name: "University of Bristol", country: "United Kingdom", site: "https://www.bristol.ac.uk" },
  { rank: 52, name: "Carnegie Mellon University", country: "United States", site: "https://www.cmu.edu" },
  { rank: 53, name: "The University of Amsterdam", country: "Netherlands", site: "https://www.uva.nl" },
  { rank: 54, name: "The Hong Kong Polytechnic University", country: "Hong Kong", site: "https://www.polyu.edu.hk" },
  { rank: 55, name: "New York University (NYU)", country: "United States", site: "https://www.nyu.edu" },
  { rank: 56, name: "London School of Economics and Political Science (LSE)", country: "United Kingdom", site: "https://www.lse.ac.uk" },
  { rank: 57, name: "Kyoto University", country: "Japan", site: "https://www.kyoto-u.ac.jp" },
  { rank: 58, name: "Ludwig-Maximilians-Universität München", country: "Germany", site: "https://www.lmu.de" },
  { rank: 58, name: "Universiti Malaya (UM)", country: "Malaysia", site: "https://www.um.edu.my" },
  { rank: 60, name: "KU Leuven", country: "Belgium", site: "https://www.kuleuven.be" },
  { rank: 61, name: "Korea University", country: "South Korea", site: "https://www.korea.ac.kr" },
  { rank: 62, name: "Duke University", country: "United States", site: "https://www.duke.edu" },
  { rank: 63, name: "City University of Hong Kong", country: "Hong Kong", site: "https://www.cityu.edu.hk" },
  { rank: 63, name: "National Taiwan University (NTU)", country: "Taiwan", site: "https://www.ntu.edu.tw" },
  { rank: 65, name: "The University of Auckland", country: "New Zealand", site: "https://www.auckland.ac.nz" },
  { rank: 66, name: "University of California, San Diego (UCSD)", country: "United States", site: "https://www.ucsd.edu" },
  { rank: 67, name: "King Fahd University of Petroleum & Minerals", country: "Saudi Arabia", site: "https://www.kfupm.edu.sa" },
  { rank: 68, name: "University of Texas at Austin", country: "United States", site: "https://www.utexas.edu" },
  { rank: 69, name: "Brown University", country: "United States", site: "https://www.brown.edu" },
  { rank: 70, name: "Université Paris-Saclay", country: "France", site: "https://www.universite-paris-saclay.fr" },
  { rank: 70, name: "University of Illinois at Urbana-Champaign", country: "United States", site: "https://illinois.edu" },
  { rank: 72, name: "Lund University", country: "Sweden", site: "https://www.lu.se" },
  { rank: 72, name: "Sorbonne University (merged from Paris IV & UPMC)", country: "France", site: "https://www.sorbonne-universite.fr" },
  { rank: 74, name: "The University of Warwick", country: "United Kingdom", site: "https://warwick.ac.uk" },
  { rank: 75, name: "Trinity College Dublin, The University of Dublin", country: "Ireland", site: "https://www.tcd.ie" },
  { rank: 76, name: "University of Birmingham", country: "United Kingdom", site: "https://www.birmingham.ac.uk" },
  { rank: 77, name: "The University of Western Australia", country: "Australia", site: "https://www.uwa.edu.au" },
  { rank: 78, name: "KTH Royal Institute of Technology", country: "Sweden", site: "https://www.kth.se" },
  { rank: 79, name: "University of Glasgow", country: "United Kingdom", site: "https://www.gla.ac.uk" },
  { rank: 80, name: "Ruprecht-Karls-Universität Heidelberg", country: "Germany", site: "https://www.uni-heidelberg.de" },
  { rank: 81, name: "University of Washington", country: "United States", site: "https://www.washington.edu" },
  { rank: 82, name: "Adelaide University", country: "Australia", site: "https://www.adelaide.edu.au" },
  { rank: 82, name: "Pennsylvania State University", country: "United States", site: "https://www.psu.edu" },
  { rank: 84, name: "Universidad de Buenos Aires", country: "Argentina", site: "https://www.uba.ar" },
  { rank: 85, name: "Tokyo Institute of Technology", country: "Japan", site: "https://www.titech.ac.jp" },
  { rank: 86, name: "University of Leeds", country: "United Kingdom", site: "https://www.leeds.ac.uk" },
  { rank: 87, name: "University of Southampton", country: "United Kingdom", site: "https://www.southampton.ac.uk" },
  { rank: 88, name: "Boston University", country: "United States", site: "https://www.bu.edu" },
  { rank: 88, name: "Freie Universität Berlin", country: "Germany", site: "https://www.fu-berlin.de" },
  { rank: 88, name: "Purdue University", country: "United States", site: "https://www.purdue.edu" },
  { rank: 91, name: "The University of Osaka", country: "Japan", site: "https://www.osaka-u.ac.jp" },
  { rank: 92, name: "The University of Sheffield", country: "United Kingdom", site: "https://www.sheffield.ac.uk" },
  { rank: 93, name: "Uppsala University", country: "Sweden", site: "https://www.uu.se" },
  { rank: 94, name: "Durham University", country: "United Kingdom", site: "https://www.durham.ac.uk" },
  { rank: 94, name: "University of Alberta", country: "Canada", site: "https://www.ualberta.ca" },
  { rank: 96, name: "University of Technology Sydney", country: "Australia", site: "https://www.uts.edu.au" },
  { rank: 97, name: "The University of Nottingham", country: "United Kingdom", site: "https://www.nottingham.ac.uk" },
  { rank: 98, name: "Karlsruhe Institute of Technology (KIT)", country: "Germany", site: "https://www.kit.edu" },
  { rank: 98, name: "Politecnico di Milano", country: "Italy", site: "https://www.polimi.it" },
  { rank: 100, name: "University of Zurich (UZH)", country: "Switzerland", site: "https://www.uzh.ch" },
];

const bachelorFields = [
  { name: "Economics", type: "BA/BS", note: "Core discipline", description: "The study of production, markets, and decision-making under scarcity; the most quantitative of the core social sciences." },
  { name: "Political Science", type: "BA", note: "Core discipline", description: "Government institutions, political behavior, and power — from local policy to comparative and international systems." },
  { name: "Sociology", type: "BA/BS", note: "Core discipline", description: "How social structures, institutions, and group life shape human behavior and inequality." },
  { name: "Psychology", type: "BA/BS", note: "Core discipline", description: "The scientific study of mind and behavior; consistently one of the most-enrolled social science majors." },
  { name: "Anthropology", type: "BA", note: "Core discipline", description: "Human societies and cultures across time, studied through ethnography, archaeology, and biological anthropology." },
  { name: "International Relations", type: "BA", note: "Applied field", description: "Diplomacy, conflict, and cooperation between states, often paired with economics or regional studies." },
  { name: "Criminology & Criminal Justice", type: "BA/BS", note: "Applied field", description: "Causes of crime, policing, and the justice system, drawing on sociology, law, and psychology." },
  { name: "Human Geography", type: "BA/BS", note: "Core discipline", description: "How people, cities, and economies are distributed across space — distinct from physical geography." },
  { name: "Social Work", type: "BSW", note: "Applied field", description: "Direct practice supporting individuals, families, and communities; the licensed, practice-facing wing of the social sciences." },
  { name: "Public Administration & Policy", type: "BA", note: "Applied field", description: "How governments design, fund, and evaluate policy — a common bridge into public-sector and NGO careers." },
  { name: "Communication Studies", type: "BA", note: "Applied field", description: "Media, persuasion, and interpersonal communication, from mass media theory to organizational communication." },
  { name: "Urban Studies & Planning", type: "BA/BS", note: "Applied field", description: "How cities grow, are governed, and are designed, combining geography, sociology, and policy." },
  { name: "International Development", type: "BA", note: "Applied field", description: "Global poverty, aid, and growth, drawing on economics, political science, and area studies." },
  { name: "Gender, Sexuality & Women's Studies", type: "BA", note: "Core discipline", description: "How gender and sexuality are socially constructed, and their effect on power, culture, and institutions." },
  { name: "Linguistics", type: "BA", note: "Interdisciplinary", description: "The structure and social use of language; bridges the social sciences and humanities." },
  { name: "History", type: "BA", note: "Interdisciplinary", description: "Long grouped with the social sciences in degree statistics; the study of past societies and change over time." },
];

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function populateFilters() {
  const countrySelect = document.getElementById("uni-country-filter");
  uniqueSorted(universities.map(u => u.country)).forEach(country => {
    const opt = document.createElement("option");
    opt.value = country;
    opt.textContent = country;
    countrySelect.appendChild(opt);
  });

  const typeSelect = document.getElementById("deg-type-filter");
  uniqueSorted(bachelorFields.map(d => d.type)).forEach(type => {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = type;
    typeSelect.appendChild(opt);
  });
}

function renderUniversities() {
  const query = document.getElementById("uni-search").value.trim().toLowerCase();
  const country = document.getElementById("uni-country-filter").value;
  const list = document.getElementById("uni-list");
  const count = document.getElementById("uni-count");

  const filtered = universities.filter(u => {
    const matchesQuery = u.name.toLowerCase().includes(query);
    const matchesCountry = !country || u.country === country;
    return matchesQuery && matchesCountry;
  });

  count.textContent = `${filtered.length} of ${universities.length} universities`;

  list.innerHTML = filtered.length
    ? filtered.map(u => `
      <div class="card">
        <div class="card-top">
          <h3>${u.name}</h3>
          <span class="badge">#${u.rank}</span>
        </div>
        <span class="meta">${u.country}</span>
        <a class="site-link" href="${u.site}" target="_blank" rel="noopener">Visit official site →</a>
      </div>
    `).join("")
    : `<p class="no-results">No universities match your search.</p>`;
}

function renderBachelors() {
  const query = document.getElementById("deg-search").value.trim().toLowerCase();
  const type = document.getElementById("deg-type-filter").value;
  const list = document.getElementById("deg-list");
  const count = document.getElementById("deg-count");

  const filtered = bachelorFields.filter(d => {
    const matchesQuery = d.name.toLowerCase().includes(query);
    const matchesType = !type || d.type === type;
    return matchesQuery && matchesType;
  });

  count.textContent = `${filtered.length} of ${bachelorFields.length} fields`;

  list.innerHTML = filtered.length
    ? filtered.map(d => `
      <div class="card">
        <div class="card-top">
          <h3>${d.name}</h3>
          <span class="badge">${d.type}</span>
        </div>
        <span class="meta">${d.note}</span>
        <p>${d.description}</p>
      </div>
    `).join("")
    : `<p class="no-results">No fields match your search.</p>`;
}

function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");

      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

function setupListeners() {
  document.getElementById("uni-search").addEventListener("input", renderUniversities);
  document.getElementById("uni-country-filter").addEventListener("change", renderUniversities);
  document.getElementById("deg-search").addEventListener("input", renderBachelors);
  document.getElementById("deg-type-filter").addEventListener("change", renderBachelors);
}

document.addEventListener("DOMContentLoaded", () => {
  populateFilters();
  setupTabs();
  setupListeners();
  renderUniversities();
  renderBachelors();
});
