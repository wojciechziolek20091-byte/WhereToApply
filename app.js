// Data sources:
// - Universities: QS World University Rankings 2026 (topuniversities.com)
// - Bachelor's fields: NCES Fast Facts, "Most common undergraduate fields of study" (nces.ed.gov/fastfacts/display.asp?id=37)

const universities = [
  { rank: 1, name: "Massachusetts Institute of Technology (MIT)", country: "United States", site: "https://web.mit.edu" },
  { rank: 2, name: "Imperial College London", country: "United Kingdom", site: "https://www.imperial.ac.uk" },
  { rank: 3, name: "Stanford University", country: "United States", site: "https://www.stanford.edu" },
  { rank: 4, name: "University of Oxford", country: "United Kingdom", site: "https://www.ox.ac.uk" },
  { rank: 5, name: "Harvard University", country: "United States", site: "https://www.harvard.edu" },
  { rank: 6, name: "University of Cambridge", country: "United Kingdom", site: "https://www.cam.ac.uk" },
  { rank: 7, name: "California Institute of Technology (Caltech)", country: "United States", site: "https://www.caltech.edu" },
  { rank: 8, name: "ETH Zurich", country: "Switzerland", site: "https://ethz.ch" },
  { rank: 9, name: "University College London (UCL)", country: "United Kingdom", site: "https://www.ucl.ac.uk" },
  { rank: 10, name: "National University of Singapore (NUS)", country: "Singapore", site: "https://www.nus.edu.sg" },
  { rank: 11, name: "University of Hong Kong (HKU)", country: "Hong Kong", site: "https://www.hku.hk" },
  { rank: 12, name: "Nanyang Technological University (NTU)", country: "Singapore", site: "https://www.ntu.edu.sg" },
  { rank: 13, name: "Peking University", country: "China", site: "https://www.pku.edu.cn" },
  { rank: 14, name: "Tsinghua University", country: "China", site: "https://www.tsinghua.edu.cn" },
  { rank: 15, name: "University of Pennsylvania", country: "United States", site: "https://www.upenn.edu" },
  { rank: 16, name: "Cornell University", country: "United States", site: "https://www.cornell.edu" },
  { rank: 17, name: "Yale University", country: "United States", site: "https://www.yale.edu" },
  { rank: 18, name: "Chinese University of Hong Kong (CUHK)", country: "Hong Kong", site: "https://www.cuhk.edu.hk" },
  { rank: 19, name: "University of New South Wales (UNSW Sydney)", country: "Australia", site: "https://www.unsw.edu.au" },
  { rank: 20, name: "Johns Hopkins University", country: "United States", site: "https://www.jhu.edu" },
  { rank: 21, name: "University of California, Berkeley", country: "United States", site: "https://www.berkeley.edu" },
  { rank: 22, name: "École Polytechnique Fédérale de Lausanne (EPFL)", country: "Switzerland", site: "https://www.epfl.ch" },
  { rank: 23, name: "University of Melbourne", country: "Australia", site: "https://www.unimelb.edu.au" },
  { rank: 24, name: "University of Chicago", country: "United States", site: "https://www.uchicago.edu" },
  { rank: 25, name: "Technical University of Munich (TUM)", country: "Germany", site: "https://www.tum.de" },
];

const bachelorFields = [
  { name: "Business", type: "BA/BS", share: "18.6% of all bachelor's degrees (375,418 awarded)", description: "Covers management, finance, marketing, and entrepreneurship; the single most popular bachelor's field in the US." },
  { name: "Health Professions", type: "BS", share: "13% of all bachelor's degrees (263,800 awarded)", description: "Includes nursing, public health, and allied health fields preparing students for clinical and healthcare careers." },
  { name: "Social Sciences & History", type: "BA", share: "7% of all bachelor's degrees (151,100 awarded)", description: "Political science, sociology, anthropology, and history — foundational for law, policy, and research careers." },
  { name: "Biological & Biomedical Sciences", type: "BS", share: "7% of all bachelor's degrees (131,500 awarded)", description: "Biology, genetics, and biomedical science, often a pathway to medical or graduate research programs." },
  { name: "Engineering", type: "BS", share: "126,037 degrees awarded", description: "Mechanical, electrical, civil, and other engineering disciplines focused on applied problem-solving and design." },
  { name: "Computer & Information Sciences", type: "BS", share: "104,874 degrees awarded", description: "Computer science, software engineering, and information systems — among the fastest-growing majors." },
  { name: "Communication & Journalism", type: "BA", share: "90,775 degrees awarded", description: "Media studies, journalism, and public relations, preparing students for storytelling and communications careers." },
  { name: "Visual & Performing Arts", type: "BA/BFA", share: "90,022 degrees awarded", description: "Studio art, design, music, theatre, and film, blending creative practice with critical study." },
  { name: "Education", type: "BA/BS", share: "89,398 degrees awarded", description: "Prepares future teachers and education professionals across early childhood through secondary levels." },
  { name: "Psychology", type: "BA/BS", share: "Consistently among the most popular majors", description: "The study of mind and behavior, a common foundation for careers in counseling, HR, and research." },
];

let activeTab = "universities";

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
        <span class="meta">${d.share}</span>
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
      activeTab = btn.dataset.tab;
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
