// Data sources:
// - Universities: QS World University Rankings 2026, official results (qs.com / topuniversities.com/world-university-rankings/2026)
// - Social science fields: common discipline classifications from higher-ed sources
//   (Michigan State University College of Social Science; BestColleges; Coursera "Social Science Majors")
//   and NCES Fast Facts (nces.ed.gov/fastfacts/display.asp?id=37) for the combined
//   "Social sciences & history" undergraduate degree share.

const universities = [
  {
    "rank": 1,
    "name": "Massachusetts Institute of Technology (MIT)",
    "country": "United States",
    "site": "https://web.mit.edu",
    "slug": "massachusetts-institute-of-technology-mit",
    "description": "MIT is a private research university founded in 1861 in Cambridge, Massachusetts, originally established to advance applied science and engineering education on a German polytechnic model. It is globally known for engineering, computer science, and the physical sciences, but also houses a research-active School of Humanities, Arts, and Social Sciences.",
    "competitivenessScope": "university-wide",
    "overallAcceptanceRate": "4.6% (Class of 2029)",
    "overallAcceptanceSource": "https://mitadmissions.org/apply/process/stats/",
    "programs": [
      {
        "field": "Economics",
        "programName": "Economics (Course 14-1)"
      },
      {
        "field": "Political Science",
        "programName": "Political Science (Course 17)"
      },
      {
        "field": "Anthropology",
        "programName": "Anthropology (Course 21A)"
      },
      {
        "field": "History",
        "programName": "History (Course 21H)"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "Urban Studies and Planning (Course 11)"
      },
      {
        "field": "Linguistics",
        "programName": "Linguistics and Philosophy (Course 24-2)"
      }
    ],
    "noProgramsNote": null,
    "tuitionDisplay": "$61,990–62,310/yr",
    "tuitionUSD": 62150,
    "tuitionSource": "https://registrar.mit.edu/registration-academics/tuition-fees/undergraduate",
    "ibDisplay": "Not published (holistic; admitted students average ~42)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://firstyear.mit.edu/academics-exploration/ap-transfer-credit/international-examinations/"
  },
  {
    "rank": 2,
    "name": "Imperial College London",
    "country": "United Kingdom",
    "site": "https://www.imperial.ac.uk",
    "slug": "imperial-college-london",
    "description": "Imperial College London is a public research university founded via Royal Charter in 1907, formed from the merger of the Royal College of Science, Royal School of Mines, and City and Guilds College. It is exclusively focused on science, technology, engineering, medicine, and business, and offers almost no humanities or social science degrees.",
    "competitivenessScope": "per-program",
    "programs": [
      {
        "field": "Economics",
        "programName": "BSc Economics, Finance and Data Science",
        "competitiveness": "~6.5–7% offer rate (2023/24 cycle, third-party aggregated data)",
        "sourceUrl": "https://www.uniadmissions.co.uk/application-guides/imperial-acceptance-rates/"
      }
    ],
    "noProgramsNote": "Imperial's undergraduate offerings are almost entirely science, engineering, medicine, and business; the social sciences appear only as non-degree elective modules alongside a STEM degree.",
    "tuitionDisplay": "£31,750–£55,800/yr (~$40,300–70,900)",
    "tuitionUSD": 55600,
    "tuitionSource": "https://www.imperial.ac.uk/study/fees-and-funding/undergraduate/tuition-fees/",
    "ibDisplay": "38–40 points (course-dependent)",
    "ibMin": 38,
    "ibMax": 40,
    "ibOfficial": true,
    "ibSource": "https://www.imperial.ac.uk/study/apply/undergraduate/entry-requirements/accepted-qualifications/"
  },
  {
    "rank": 3,
    "name": "Stanford University",
    "country": "United States",
    "site": "https://www.stanford.edu",
    "slug": "stanford-university",
    "description": "Stanford is a private research university founded in 1885 (opened 1891) in Stanford, California. It spans engineering, computer science, business, and a large School of Humanities and Sciences with well-developed social science departments.",
    "competitivenessScope": "university-wide",
    "overallAcceptanceRate": "3.80% (Class of 2029)",
    "overallAcceptanceSource": "https://irds.stanford.edu/data-findings/cds",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Public Administration & Policy",
        "programName": "Public Policy"
      },
      {
        "field": "Communication Studies",
        "programName": "Communication"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "Urban Studies"
      },
      {
        "field": "Gender, Sexuality & Women's Studies",
        "programName": "Feminist, Gender, and Sexuality Studies"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "History"
      }
    ],
    "noProgramsNote": null,
    "tuitionDisplay": "$62,484/yr",
    "tuitionUSD": 62484,
    "tuitionSource": "https://studentservices.stanford.edu/tuition-rates/2025-2026-undergraduate-tuition-rates",
    "ibDisplay": "Not published (holistic)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://admission.stanford.edu/apply/international/index.html"
  },
  {
    "rank": 4,
    "name": "University of Oxford",
    "country": "United Kingdom",
    "site": "https://www.ox.ac.uk",
    "slug": "university-of-oxford",
    "description": "Oxford is a public collegiate research university in England, with teaching documented as far back as 1096, making it the oldest university in the English-speaking world. It is organized as a federation of colleges, and its Philosophy, Politics and Economics (PPE) course has produced generations of British political leaders.",
    "competitivenessScope": "per-program",
    "programs": [
      {
        "field": "Economics",
        "programName": "Economics and Management",
        "competitiveness": "5% acceptance rate (1,542 applicants, 83 accepted, 2023 entry)",
        "sourceUrl": "https://oxbridgeapplications.com/resource/oxford-success-rates/"
      },
      {
        "field": "History",
        "programName": "History and Politics",
        "competitiveness": "13% acceptance rate (381 applicants, 48 accepted, 2023 entry)",
        "sourceUrl": "https://oxbridgeapplications.com/resource/oxford-success-rates/"
      },
      {
        "field": "Sociology",
        "programName": "Human Sciences",
        "competitiveness": "13% acceptance rate (193 applicants, 26 accepted, 2023 entry) — Oxford's only route to undergraduate Sociology",
        "sourceUrl": "https://oxbridgeapplications.com/resource/oxford-success-rates/"
      },
      {
        "field": "Political Science",
        "programName": "PPE (Philosophy, Politics and Economics)",
        "competitiveness": "12% acceptance rate (1,864 applicants, 229 accepted, 2023 entry)",
        "sourceUrl": "https://oxbridgeapplications.com/resource/oxford-success-rates/"
      },
      {
        "field": "Psychology",
        "programName": "Psychology, Philosophy and Linguistics",
        "competitiveness": "14% acceptance rate (275 applicants, 38 accepted, 2023 entry)",
        "sourceUrl": "https://oxbridgeapplications.com/resource/oxford-success-rates/"
      },
      {
        "field": "Anthropology",
        "programName": "Archaeology and Anthropology",
        "competitiveness": "18% acceptance rate (125 applicants, 22 accepted, 2023 entry)",
        "sourceUrl": "https://oxbridgeapplications.com/resource/oxford-success-rates/"
      },
      {
        "field": "Human Geography",
        "programName": "Geography",
        "competitiveness": "21% acceptance rate (339 applicants, 70 accepted, 2023 entry)",
        "sourceUrl": "https://oxbridgeapplications.com/resource/oxford-success-rates/"
      },
      {
        "field": "Linguistics",
        "programName": "Modern Languages and Linguistics",
        "competitiveness": "43% acceptance rate (91 applicants, 39 accepted, 2023 entry)",
        "sourceUrl": "https://oxbridgeapplications.com/resource/oxford-success-rates/"
      }
    ],
    "noProgramsNote": null,
    "tuitionDisplay": "£33,050–£62,820/yr (~$42,000–79,800)",
    "tuitionUSD": 60900,
    "tuitionSource": "https://www.ox.ac.uk/admissions/undergraduate/fees-and-funding/course-fees",
    "ibDisplay": "Typical offer 38–40 points",
    "ibMin": 38,
    "ibMax": 40,
    "ibOfficial": true,
    "ibSource": "https://www.ox.ac.uk/admissions/undergraduate/applying-to-oxford/for-international-students/international-qualifications"
  },
  {
    "rank": 5,
    "name": "Harvard University",
    "country": "United States",
    "site": "https://www.harvard.edu",
    "slug": "harvard-university",
    "description": "Harvard is a private university founded in 1636 in Cambridge, Massachusetts, the oldest institution of higher education in the United States. Harvard College is known across the liberal arts and sciences, with especially large concentrations in Economics and Government.",
    "competitivenessScope": "university-wide",
    "overallAcceptanceRate": "4.2% (Class of 2029)",
    "overallAcceptanceSource": "https://oira.harvard.edu/?p=1136",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science",
        "programName": "Government"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Gender, Sexuality & Women's Studies",
        "programName": "Studies of Women, Gender, and Sexuality"
      },
      {
        "field": "International Relations",
        "programName": "Social Studies (closest analog; interdisciplinary)"
      }
    ],
    "noProgramsNote": null,
    "tuitionDisplay": "$59,320/yr",
    "tuitionUSD": 59320,
    "tuitionSource": "https://registrar.fas.harvard.edu/tuition-and-fees",
    "ibDisplay": "Not published (holistic)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://college.harvard.edu/admissions/apply/international-applicants"
  },
  {
    "rank": 6,
    "name": "University of Cambridge",
    "country": "United Kingdom",
    "site": "https://www.cam.ac.uk",
    "slug": "university-of-cambridge",
    "description": "Founded in 1209, Cambridge is a public, collegiate research university in England, one of the oldest in continuous operation in the English-speaking world. It is organized around 31 semi-autonomous colleges and is broadly strong across both the sciences and humanities.",
    "competitivenessScope": "per-program",
    "programs": [
      {
        "field": "Psychology",
        "programName": "Psychological and Behavioural Sciences",
        "competitiveness": "11.67% offer rate (2023/24 cycle)",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/university-acceptance-rates/uoc/psychology/psychological-and-behavioural-scis/"
      },
      {
        "field": "Economics",
        "programName": "Economics",
        "competitiveness": "13.70% offer rate (1,336 applications, 183 offers, 2023/24)",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/university-acceptance-rates/uoc/economics/"
      },
      {
        "field": "Political Science",
        "programName": "Human, Social, and Political Sciences (HSPS)",
        "competitiveness": "15.25% offer rate (1,436 applications, 219 offers, 2023/24) — combined route also covering Sociology, Anthropology, International Relations",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/university-acceptance-rates/uoc/sociology-and-anthropology/human-social-and-political-scis/"
      },
      {
        "field": "Human Geography",
        "programName": "Geography",
        "competitiveness": "26.34% offer rate (524 applications, 138 offers, 2023/24)",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/university-acceptance-rates/uoc/geography-and-earth-sciences/geo/"
      },
      {
        "field": "History",
        "programName": "History",
        "competitiveness": "35.09% offer rate (607 applications, 213 offers, 2023/24)",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/university-acceptance-rates/uoc/history-and-archaeology/hist/"
      },
      {
        "field": "Linguistics",
        "programName": "Linguistics",
        "competitiveness": "36.97% offer rate (119 applications, 44 offers, 2023/24)",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/university-acceptance-rates/uoc/english-language-and-linguistics/ling/"
      }
    ],
    "tuitionDisplay": "£25,734–£70,554/yr (~$32,700–89,600)",
    "tuitionUSD": 61150,
    "tuitionSource": "https://www.undergraduate.study.cam.ac.uk/international-students/international-fees-and-costs",
    "ibDisplay": "Typical offer ~40–42 points (college-dependent)",
    "ibMin": 40,
    "ibMax": 42,
    "ibOfficial": true,
    "ibSource": "https://www.undergraduate.study.cam.ac.uk/apply/before/accepted-qualifications"
  },
  {
    "rank": 7,
    "name": "ETH Zurich (Swiss Federal Institute of Technology)",
    "country": "Switzerland",
    "site": "https://ethz.ch",
    "slug": "eth-zurich-swiss-federal-institute-of-technology",
    "description": "Founded in 1855 as the Swiss Federal Polytechnic School, ETH Zurich is a public federal institute of technology, overwhelmingly focused on engineering, natural sciences, mathematics, and computer science.",
    "competitivenessScope": "unverified",
    "programs": [],
    "noProgramsNote": "ETH offers no general-public undergraduate social science degree. Its only bachelor's-level social science offering, a BA in Public Policy, is restricted to career officers of the Swiss Armed Forces and not open to ordinary applicants.",
    "tuitionDisplay": "CHF ~4,380/yr (~$4,900)",
    "tuitionUSD": 4900,
    "tuitionSource": "https://ethz.ch/en/studies/financial/tuition-fees.html",
    "ibDisplay": "Minimum 38/42 points",
    "ibMin": 38,
    "ibMax": 42,
    "ibOfficial": true,
    "ibSource": "https://ethz.ch/en/studies/bachelor/application/non-swiss-matriculation-certificate/admission-prerequisites.html"
  },
  {
    "rank": 8,
    "name": "National University of Singapore (NUS)",
    "country": "Singapore",
    "site": "https://www.nus.edu.sg",
    "slug": "national-university-of-singapore-nus",
    "description": "NUS traces to a 1905 medical school and took its current form in a 1980 merger. It is a public, comprehensive research university in Singapore spanning engineering, business, medicine, law, and the arts and social sciences.",
    "competitivenessScope": "university-wide",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Communication Studies",
        "programName": "Communications and New Media"
      },
      {
        "field": "Human Geography",
        "programName": "Geography"
      }
    ],
    "noProgramsNote": null,
    "tuitionDisplay": "SGD 17,550–65,700/yr (~$13,000–48,600)",
    "tuitionUSD": 30800,
    "tuitionSource": "https://www.nus.edu.sg/registrar/administrative-policies-procedures/undergraduate/undergraduate-fees",
    "ibDisplay": "Not an official fixed minimum; competitive range ~38–45 cited",
    "ibMin": 38,
    "ibMax": 45,
    "ibOfficial": false,
    "ibSource": "https://nus.edu.sg/oam/admissions/ib-diploma/admission-requirements"
  },
  {
    "rank": 9,
    "name": "UCL (University College London)",
    "country": "United Kingdom",
    "site": "https://www.ucl.ac.uk",
    "slug": "ucl-university-college-london",
    "description": "Founded in 1826, UCL was the first English university to admit students regardless of religion. It is a public research university in London with broad strength across medicine, sciences, engineering, and social sciences.",
    "competitivenessScope": "per-program",
    "programs": [
      {
        "field": "Psychology",
        "programName": "BSc Psychology",
        "competitiveness": "16.51% offer rate (2024/25)",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/university-acceptance-rates/ucl/psychology/bsc-psych/"
      },
      {
        "field": "Economics",
        "programName": "BSc(Econ) Economics",
        "competitiveness": "32% offer rate (2024/25)",
        "sourceUrl": "https://www.admissionreport.com/university-college-london/bsc-econ-economics"
      },
      {
        "field": "Sociology",
        "programName": "BSc Sociology",
        "competitiveness": "32% offer rate (2024/25)",
        "sourceUrl": "https://www.admissionreport.com/university-college-london/bsc-sociology"
      },
      {
        "field": "Linguistics",
        "programName": "BA Linguistics",
        "competitiveness": "~32% offer rate (2024/25)",
        "sourceUrl": "https://www.admissionreport.com/university-college-london/ba-linguistics"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "BSc Urban Planning, Design and Management",
        "competitiveness": "35.74% offer rate (249 applications, 89 offers, 2024/25)",
        "sourceUrl": "https://www.admissionreport.com/university-college-london/bsc-urban-planning-design-and-management"
      },
      {
        "field": "Political Science",
        "programName": "BSc Politics and International Relations",
        "competitiveness": "38.50% offer rate (2024/25)",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/university-acceptance-rates/ucl/politics-and-international-relations/"
      },
      {
        "field": "Communication Studies",
        "programName": "Communications BA",
        "competitiveness": "~42% offer rate (derived, lower confidence)",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/insights/ucl-admissions-statistics/"
      },
      {
        "field": "Criminology & Criminal Justice",
        "programName": "Crime and Security Science BSc",
        "competitiveness": "57.95% offer rate (2024/25)",
        "sourceUrl": "https://www.savemyexams.com/learning-hub/university-acceptance-rates/ucl/criminology-and-forensics/"
      },
      {
        "field": "Anthropology",
        "programName": "BSc Anthropology",
        "competitiveness": "76% offer rate (2024/25)",
        "sourceUrl": "https://www.admissionreport.com/university-college-london/bsc-anthropology"
      },
      {
        "field": "Human Geography",
        "programName": "BSc Geography",
        "competitiveness": "77% offer rate (2024/25)",
        "sourceUrl": "https://www.admissionreport.com/university-college-london/bsc-geography"
      },
      {
        "field": "History",
        "programName": "BA History",
        "competitiveness": "82% offer rate (2024/25)",
        "sourceUrl": "https://www.admissionreport.com/university-college-london/ba-history"
      }
    ],
    "tuitionDisplay": "£26,200–£47,000/yr (~$33,300–59,700)",
    "tuitionUSD": 46500,
    "tuitionSource": "https://www.ucl.ac.uk/study/student-finances/tuition-fees/fee-schedules/fee-schedules-2026-2027/undergraduate-fees-2026-2027",
    "ibDisplay": "34–40 points depending on course",
    "ibMin": 34,
    "ibMax": 40,
    "ibOfficial": true,
    "ibSource": "https://www.ucl.ac.uk/study/prospective-students/undergraduate/how-apply/entry-requirements"
  },
  {
    "rank": 10,
    "name": "California Institute of Technology (Caltech)",
    "country": "United States",
    "site": "https://www.caltech.edu",
    "slug": "california-institute-of-technology-caltech",
    "description": "Founded in 1891 as Throop University (renamed Caltech in 1920), Caltech is a small, private, STEM-focused research university in Pasadena, California, known for physics and engineering and for managing NASA's Jet Propulsion Laboratory.",
    "competitivenessScope": "university-wide",
    "overallAcceptanceRate": "~3.8% (Class of 2029)",
    "overallAcceptanceSource": "https://www.ivycoach.com/the-ivy-coach-blog/college-admissions/caltech-admissions-statistics/",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "History"
      }
    ],
    "noProgramsNote": null,
    "tuitionDisplay": "$65,622/yr",
    "tuitionUSD": 65622,
    "tuitionSource": "https://www.catalog.caltech.edu/current/information-for-undergraduate-students/undergraduate-expenses/",
    "ibDisplay": "Not published (holistic; admitted average ~44)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://www.admissions.caltech.edu/apply/first-year-applicants/international-applicants"
  },
  {
    "rank": 11,
    "name": "The University of Hong Kong",
    "country": "Hong Kong",
    "site": "https://www.hku.hk",
    "slug": "the-university-of-hong-kong",
    "description": "Founded in 1911, HKU is Hong Kong's oldest tertiary institution, a public research university known for its Faculty of Social Sciences, Faculty of Law, and Li Ka Shing Faculty of Medicine.",
    "competitivenessScope": "per-program",
    "programs": [
      {
        "field": "Economics",
        "programName": "Bachelor of Economics / Economics and Finance",
        "competitiveness": "JUPAS expected score 34 (2025, higher = more competitive)",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "History",
        "programName": "Bachelor of Arts (JS6054)",
        "competitiveness": "JUPAS expected score 28 (2025) — also houses Linguistics and Gender Studies majors, chosen after Year 1",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Linguistics",
        "programName": "Bachelor of Arts (JS6054)",
        "competitiveness": "JUPAS expected score 28 (2025) — shared BA entry point",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Gender, Sexuality & Women's Studies",
        "programName": "Bachelor of Arts (JS6054)",
        "competitiveness": "JUPAS expected score 28 (2025) — shared BA entry point",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Psychology",
        "programName": "Bachelor of Psychology",
        "competitiveness": "JUPAS expected score 28 (2025)",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Social Work",
        "programName": "Bachelor of Social Work",
        "competitiveness": "JUPAS expected score 26 (2025)",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Political Science",
        "programName": "Bachelor of Social Sciences (BSocSc)",
        "competitiveness": "JUPAS expected score 24 (2025) — shared entry point, majors chosen after Year 1",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Sociology",
        "programName": "Bachelor of Social Sciences (BSocSc)",
        "competitiveness": "JUPAS expected score 24 (2025) — shared entry point",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Public Administration & Policy",
        "programName": "Bachelor of Social Sciences (BSocSc)",
        "competitiveness": "JUPAS expected score 24 (2025) — shared entry point",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Human Geography",
        "programName": "Bachelor of Social Sciences (BSocSc)",
        "competitiveness": "JUPAS expected score 24 (2025) — shared entry point",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Communication Studies",
        "programName": "Bachelor of Journalism",
        "competitiveness": "JUPAS expected score 24 (2025)",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "BA Urban Studies",
        "competitiveness": "JUPAS expected score 24 (2025)",
        "sourceUrl": "https://admissions.hku.hk/sites/default/files/2025-01/HKU-JUPAS-Expected-Score-2025.pdf"
      }
    ],
    "tuitionDisplay": "HKD 182,000–218,000/yr (~$23,300–27,900)",
    "tuitionUSD": 25600,
    "tuitionSource": "https://admissions.hku.hk/fees-and-scholarships/fees",
    "ibDisplay": "Not published as a fixed minimum (44+ triggers full scholarship)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://admissions.hku.hk/apply/international-qualifications"
  },
  {
    "rank": 12,
    "name": "Nanyang Technological University, Singapore (NTU Singapore)",
    "country": "Singapore",
    "site": "https://www.ntu.edu.sg",
    "slug": "nanyang-technological-university-singapore-ntu-singapore",
    "description": "NTU traces its roots to Nanyang University (1955) and took its current form in a 1991 merger. It is a public autonomous university known for engineering and business, with a College of Humanities, Arts & Social Sciences.",
    "competitivenessScope": "per-program",
    "programs": [
      {
        "field": "Psychology",
        "competitiveness": "AY2024-25 Indicative Grade Profile: 10th percentile AAC/B, 90th percentile AAA/A",
        "sourceUrl": "https://www3.ntu.edu.sg/oad2/website_files/igp/ntu_igp.pdf"
      },
      {
        "field": "Public Administration & Policy",
        "programName": "Public Policy & Global Affairs",
        "competitiveness": "10th percentile AAC/B, 90th percentile AAA/A",
        "sourceUrl": "https://www3.ntu.edu.sg/oad2/website_files/igp/ntu_igp.pdf"
      },
      {
        "field": "Communication Studies",
        "competitiveness": "10th percentile AAC/C, 90th percentile AAA/A",
        "sourceUrl": "https://www3.ntu.edu.sg/oad2/website_files/igp/ntu_igp.pdf"
      },
      {
        "field": "Economics",
        "competitiveness": "10th percentile BBC/B, 90th percentile AAA/A",
        "sourceUrl": "https://www3.ntu.edu.sg/oad2/website_files/igp/ntu_igp.pdf"
      },
      {
        "field": "Linguistics",
        "programName": "Linguistics & Multilingual Studies",
        "competitiveness": "10th percentile BBC/C, 90th percentile AAA/A",
        "sourceUrl": "https://www3.ntu.edu.sg/oad2/website_files/igp/ntu_igp.pdf"
      },
      {
        "field": "Sociology",
        "competitiveness": "10th percentile BBC/C, 90th percentile AAB/B",
        "sourceUrl": "https://www3.ntu.edu.sg/oad2/website_files/igp/ntu_igp.pdf"
      },
      {
        "field": "History",
        "competitiveness": "10th percentile BCC/C, 90th percentile AAB/B",
        "sourceUrl": "https://www3.ntu.edu.sg/oad2/website_files/igp/ntu_igp.pdf"
      }
    ],
    "tuitionDisplay": "SGD 17,800–89,100/yr (~$13,200–65,900)",
    "tuitionUSD": 39500,
    "tuitionSource": "https://www.ntu.edu.sg/admissions/undergraduate/financial-matters/tuition-fees",
    "ibDisplay": "Not published (varies year to year)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://www.ntu.edu.sg/admissions/undergraduate/admission-guide/international-baccalaureate-diploma"
  },
  {
    "rank": 13,
    "name": "University of Chicago",
    "country": "United States",
    "site": "https://www.uchicago.edu",
    "slug": "university-of-chicago",
    "description": "Founded in 1890, the University of Chicago is a private research university known for its rigorous Core Curriculum and for economics, a field in which it has produced many Nobel laureates.",
    "competitivenessScope": "university-wide",
    "overallAcceptanceRate": "4.48% (Class of 2028)",
    "overallAcceptanceSource": "https://www.koppelmangroup.com/blog/2026/1/18/uchicago-admissions-statistics-2025",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "History"
      },
      {
        "field": "Gender, Sexuality & Women's Studies",
        "programName": "Gender and Sexuality Studies"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Public Administration & Policy",
        "programName": "Public Policy Studies"
      },
      {
        "field": "Human Geography",
        "programName": "Environment, Geography, and Urbanization"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "Environment, Geography, and Urbanization"
      }
    ],
    "noProgramsNote": null,
    "tuitionDisplay": "$75,960/yr",
    "tuitionUSD": 75960,
    "tuitionSource": "https://bursar.uchicago.edu/tuition-and-fees/tuition-and-fees-2025-26/tuition-and-fees-2025-26-college",
    "ibDisplay": "Not published (holistic)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 14,
    "name": "Peking University",
    "country": "China",
    "site": "https://www.pku.edu.cn",
    "slug": "peking-university",
    "description": "Founded in 1898, Peking University is a public university in Beijing and one of China's oldest and most prestigious institutions, a member of the C9 League of elite Chinese universities.",
    "competitivenessScope": "university-wide",
    "overallAcceptanceRate": "Not published as an applications-to-admits rate; admission is via province-level gaokao score cutoffs. 2024 Beijing cutoffs: Unrestricted Group I 688/750, Group II 700/750, Physics-Chemistry Group 690/750",
    "overallAcceptanceSource": "https://bkzs.pku.edu.cn/xxgk/lqfsx/2f23dc2f47ae4f46a90d39efd06c7b1a.htm",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science",
        "programName": "政治学与行政学"
      },
      {
        "field": "Public Administration & Policy",
        "programName": "行政管理"
      },
      {
        "field": "International Relations",
        "programName": "国际政治/外交学"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Social Work",
        "programName": "社会工作"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Human Geography",
        "programName": "人文地理与城乡规划"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "人文地理与城乡规划"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "Linguistics",
        "programName": "汉语语言学"
      },
      {
        "field": "History"
      }
    ],
    "noProgramsNote": null,
    "tuitionDisplay": "¥26,000/yr humanities, ¥30,000/yr sciences (~$3,600–4,200)",
    "tuitionUSD": 3900,
    "tuitionSource": "https://isd.pku.edu.cn/en/detail.php?id=813",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 15,
    "name": "University of Pennsylvania",
    "country": "United States",
    "site": "https://www.upenn.edu",
    "slug": "university-of-pennsylvania",
    "description": "Founded in 1740 and chartered in 1755, UPenn is a private Ivy League research university in Philadelphia founded by Benjamin Franklin, known for the Wharton School alongside its College of Arts and Sciences.",
    "competitivenessScope": "university-wide",
    "overallAcceptanceRate": "4.87% (Class of 2029, secondary-sourced)",
    "overallAcceptanceSource": "https://www.crimsoneducation.org/hk-en/blog/university-of-pennsylvania-acceptance-rate",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Criminology & Criminal Justice",
        "programName": "Criminology"
      },
      {
        "field": "Communication Studies",
        "programName": "Communication"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "Urban Studies"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "History"
      }
    ],
    "noProgramsNote": null,
    "tuitionDisplay": "~$71,369/yr (2025-26 est.)",
    "tuitionUSD": 71369,
    "tuitionSource": "https://srfs.upenn.edu/costs-budgeting/undergraduate-tuition-and-fees",
    "ibDisplay": "Not published (holistic)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://admissions.upenn.edu/how-to-apply/international-applicants"
  },
  {
    "rank": 16,
    "name": "Cornell University",
    "country": "United States",
    "site": "https://www.cornell.edu",
    "slug": "cornell-university",
    "description": "A private research university (with several statutory land-grant colleges) in Ithaca, New York, founded in 1865. An Ivy League member known for its \"any person...any study\" ethos and breadth across colleges, from Arts & Sciences to Engineering, Business, and Human Ecology.",
    "competitivenessScope": "university-wide",
    "overallAcceptanceRate": "~8.4% (Class of 2029)",
    "overallAcceptanceSource": "https://irp.cornell.edu/common-data-set",
    "tuitionDisplay": "$73,946/yr (endowed colleges incl. Arts & Sciences)",
    "tuitionUSD": 73946,
    "tuitionSource": "https://bursar.cornell.edu/students-parents/tuition-rates-and-fees",
    "ibDisplay": "Not published — Cornell states there is no minimum score and uses fully holistic review",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://cornelladmissions.happyfox.com/kb/article/474-what-score-do-i-need-to-apply-to-cornell/",
    "programs": [
      {
        "field": "Economics",
        "programName": "Applied Economics and Management"
      },
      {
        "field": "Economics",
        "programName": "Economics (College of Arts & Sciences)"
      },
      {
        "field": "Political Science",
        "programName": "Government"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Gender, Sexuality & Women's Studies",
        "programName": "Feminist, Gender & Sexuality Studies"
      },
      {
        "field": "Communication Studies",
        "programName": "Communication (BS, CALS)"
      },
      {
        "field": "Public Administration & Policy",
        "programName": "Policy Analysis and Management"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "Urban and Regional Studies"
      },
      {
        "field": "International Development",
        "programName": "Global Development"
      }
    ],
    "noProgramsNote": null
  },
  {
    "rank": 17,
    "name": "Tsinghua University",
    "country": "China",
    "site": "https://www.tsinghua.edu.cn",
    "slug": "tsinghua-university",
    "description": "A public research university in Beijing founded in 1911, consistently ranked China's top or second university. Globally renowned for engineering and STEM, but also home to a historically significant School of Social Sciences tracing to 1926.",
    "competitivenessScope": "unverified",
    "overallAcceptanceRate": "No official applications-to-admits rate published; domestic admission is via gaokao score cutoffs, generally requiring roughly the top 0.1-0.5% nationally (low-confidence, third-party aggregated)",
    "tuitionDisplay": "RMB 26,000-30,000/yr (~$3,600-4,200)",
    "tuitionUSD": 3900,
    "tuitionSource": "https://international.join-tsinghua.edu.cn/Admission1/Fees.htm",
    "ibDisplay": "Not published; third-party suggests a practical benchmark around 38+ for English-taught programs (unofficial)",
    "ibMin": 38,
    "ibMax": 38,
    "ibOfficial": false,
    "ibSource": null,
    "programs": [
      {
        "field": "Economics",
        "programName": "Economics (Institute of Economics)"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Communication Studies",
        "programName": "Journalism"
      },
      {
        "field": "History"
      }
    ],
    "noProgramsNote": null
  },
  {
    "rank": 17,
    "name": "University of California, Berkeley (UCB)",
    "country": "United States",
    "site": "https://www.berkeley.edu",
    "slug": "university-of-california-berkeley-ucb",
    "description": "The public flagship of the University of California system, founded in 1868 in Berkeley. Consistently ranked the top public university in the US, globally renowned across sciences, engineering, and social sciences — notably economics.",
    "competitivenessScope": "university-wide",
    "overallAcceptanceRate": "11.4% (Fall 2024, official)",
    "overallAcceptanceSource": "https://admission.universityofcalifornia.edu/campuses-majors/berkeley/first-year-admit-data.html",
    "tuitionDisplay": "~$48,726 base nonresident tuition & fees (total with supplemental nonresident tuition can exceed $80,000)",
    "tuitionUSD": 48726,
    "tuitionSource": "https://registrar.berkeley.edu/tuition-fees/fee-schedule/",
    "ibDisplay": "Not published; UC-wide 30+ earns unit credit. Admitted-student 25th/75th percentile is 37/43 (informal benchmark, not a stated cutoff)",
    "ibMin": 37,
    "ibMax": 43,
    "ibOfficial": false,
    "ibSource": "https://admissions.berkeley.edu/requirements-for-international-students/",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "International Development",
        "programName": "Development Studies"
      },
      {
        "field": "Communication Studies",
        "programName": "Media Studies"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "Urban Studies"
      },
      {
        "field": "Gender, Sexuality & Women's Studies",
        "programName": "Gender and Women's Studies"
      },
      {
        "field": "Human Geography",
        "programName": "Geography"
      }
    ],
    "noProgramsNote": null
  },
  {
    "rank": 19,
    "name": "The University of Melbourne",
    "country": "Australia",
    "site": "https://www.unimelb.edu.au",
    "slug": "the-university-of-melbourne",
    "description": "A public research university in Melbourne, Australia, founded in 1853 — the country's second-oldest university. Consistently ranked #1 in Australia, known for the \"Melbourne Model\" of broad undergraduate degrees feeding into professional and graduate study.",
    "competitivenessScope": "per-program",
    "tuitionDisplay": "Bachelor of Arts ~AUD 40,000-44,000/yr (~$26,000-29,000); Bachelor of Commerce ~AUD 54,463-63,316/yr (~$36,000-42,000)",
    "tuitionUSD": 30000,
    "tuitionSource": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/fees/",
    "ibDisplay": "Published per course, but figures found conflict between sources (one ~29, another 36-40+); not independently confirmed this pass",
    "ibMin": 29,
    "ibMax": 40,
    "ibOfficial": false,
    "ibSource": "https://study.unimelb.edu.au/how-to-apply/guaranteed-and-minimum-entry-scores-for-international-students",
    "programs": [
      {
        "field": "Economics",
        "programName": "Economics (via Bachelor of Commerce)",
        "competitiveness": "Guaranteed ATAR 92.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-commerce/entry-requirements/"
      },
      {
        "field": "Political Science",
        "programName": "Politics and International Studies (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026; one source cites a lower 83.0 — unresolved discrepancy)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "Psychology",
        "programName": "Psychology (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "Sociology",
        "programName": "Sociology (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "Criminology & Criminal Justice",
        "programName": "Criminology (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "Anthropology",
        "programName": "Anthropology (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "History",
        "programName": "History (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "Linguistics",
        "programName": "Linguistics and Applied Linguistics (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "Human Geography",
        "programName": "Geography (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "Gender, Sexuality & Women's Studies",
        "programName": "Gender Studies (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "Communication Studies",
        "programName": "Media and Communications (via BA)",
        "competitiveness": "Guaranteed ATAR 88.0 (2026)",
        "sourceUrl": "https://study.unimelb.edu.au/find/courses/undergraduate/bachelor-of-arts/entry-requirements/"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "Urban Planning (via Bachelor of Design)",
        "competitiveness": "Entry score not confirmed this pass",
        "sourceUrl": "https://study.unimelb.edu.au"
      }
    ]
  },
  {
    "rank": 20,
    "name": "The University of New South Wales",
    "country": "Australia",
    "site": "https://www.unsw.edu.au",
    "slug": "the-university-of-new-south-wales",
    "description": "A public research university in Sydney, Australia, founded in 1949 and a member of the \"Group of Eight\" leading Australian research universities. Strong in engineering, business, and law, with growing arts and social science offerings.",
    "competitivenessScope": "per-program",
    "tuitionDisplay": "Bachelor of Arts ~AUD 51,000 first year (2026), ~$34,000/yr equivalent",
    "tuitionUSD": 34000,
    "tuitionSource": "https://www.unsw.edu.au/study/undergraduate/bachelor-of-arts",
    "ibDisplay": "Published per program on UNSW's official international direct-entry table, ranging 28-36 out of 45",
    "ibMin": 28,
    "ibMax": 36,
    "ibOfficial": true,
    "ibSource": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf",
    "programs": [
      {
        "field": "Psychology",
        "programName": "Psychology (Hons)",
        "competitiveness": "IB 36 / ATAR 92 (official 2026 international direct-entry table)",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Economics",
        "competitiveness": "IB 35 / ATAR 89",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Political Science",
        "programName": "Politics, Philosophy and Economics",
        "competitiveness": "IB 33 / ATAR 85",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "International Relations",
        "programName": "Arts — Politics and International Relations major",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Sociology",
        "programName": "Arts — Sociology major",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Anthropology",
        "programName": "Sociology and Anthropology stream",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Criminology & Criminal Justice",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "History",
        "programName": "History (via Arts)",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Linguistics",
        "programName": "Linguistics (via Arts)",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Communication Studies",
        "programName": "Media",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Social Work",
        "programName": "Social Work (Hons)",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Urban Studies & Planning",
        "programName": "City Planning (Hons)",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "Human Geography",
        "programName": "Geographical Studies major",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      },
      {
        "field": "International Development",
        "programName": "Global Development major",
        "competitiveness": "IB 28 / ATAR 75",
        "sourceUrl": "https://www.unsw.edu.au/content/dam/pdfs/future-students/UNSW_INT_Admissions-table_20250710.pdf"
      }
    ]
  },
  {
    "rank": 21,
    "name": "Yale University",
    "country": "United States",
    "site": "https://www.yale.edu",
    "slug": "yale-university",
    "description": "Yale is a private Ivy League university in New Haven, Connecticut, founded in 1701. Its liberal arts college is built around a broad distribution curriculum, with particular strength in political science, history, and economics.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "$65,000/yr",
    "tuitionUSD": 65000,
    "tuitionSource": "https://student-accounts.yale.edu/tuition-and-fees",
    "ibDisplay": "Not published (holistic)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://admissions.yale.edu/applying-yale-international-student"
  },
  {
    "rank": 22,
    "name": "École Polytechnique Fédérale de Lausanne",
    "country": "Switzerland",
    "site": "https://www.epfl.ch",
    "slug": "ecole-polytechnique-federale-de-lausanne",
    "description": "EPFL is Switzerland's federal institute of technology in Lausanne, tracing back to 1853 and gaining federal status in 1969. Like its sister institution ETH Zurich, its bachelor's programs are concentrated almost entirely in engineering, computer science, and the natural sciences.",
    "programs": [],
    "noProgramsNote": "This university's undergraduate offerings are concentrated in engineering and the natural sciences; it has no dedicated social science bachelor's programs.",
    "tuitionDisplay": "CHF ~4,380/yr (~$4,900)",
    "tuitionUSD": 4900,
    "tuitionSource": "https://www.epfl.ch/education/studies/en/rules-and-procedures/study-taxes/tuition-fee-other-fees/",
    "ibDisplay": "Minimum 38/42 points (36/42 if Swiss resident)",
    "ibMin": 38,
    "ibMax": 42,
    "ibOfficial": true,
    "ibSource": "https://www.epfl.ch/education/admission/admission-2/bachelor-admission-criteria-and-application/"
  },
  {
    "rank": 22,
    "name": "Technical University of Munich",
    "country": "Germany",
    "site": "https://www.tum.de",
    "slug": "technical-university-of-munich",
    "description": "TUM is a public technical university founded in 1868, one of Germany's leading engineering and natural-science institutions. Its undergraduate offerings are overwhelmingly STEM-focused, though it runs a School of Social Sciences and Technology mostly at graduate level.",
    "programs": [
      {
        "field": "Economics"
      }
    ],
    "tuitionDisplay": "€4,000–6,000/yr (~$4,240–6,360)",
    "tuitionUSD": 5300,
    "tuitionSource": "https://www.tum.de/en/studies/fees/tuition",
    "ibDisplay": "Not published as a fixed minimum",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://www.tum.de/en/studies/application/application-info-portal/applicants-with-international-baccalaureate"
  },
  {
    "rank": 24,
    "name": "Johns Hopkins University",
    "country": "United States",
    "site": "https://www.jhu.edu",
    "slug": "johns-hopkins-university",
    "description": "Johns Hopkins is a private research university in Baltimore, founded in 1876 as the first US university built around graduate research. Its undergraduate International Studies and Political Science programs are especially well known, feeding into the affiliated Johns Hopkins SAIS.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "International Development"
      }
    ],
    "tuitionDisplay": "$66,670/yr",
    "tuitionUSD": 66670,
    "tuitionSource": "https://www.jhu.edu/admissions/tuition/",
    "ibDisplay": "Not published (holistic)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://apply.jhu.edu/international-applicants/"
  },
  {
    "rank": 25,
    "name": "Princeton University",
    "country": "United States",
    "site": "https://www.princeton.edu",
    "slug": "princeton-university",
    "description": "Princeton is a private Ivy League university in New Jersey, founded in 1746. Its School of Public and International Affairs (until 2020 the Woodrow Wilson School) and its economics and politics departments are among the most selective undergraduate programs in the US.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Public Administration & Policy"
      }
    ],
    "tuitionDisplay": "$65,210/yr",
    "tuitionUSD": 65210,
    "tuitionSource": "https://admission.princeton.edu/cost-aid",
    "ibDisplay": "Not published (holistic)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://admission.princeton.edu/apply/international-students"
  },
  {
    "rank": 25,
    "name": "The University of Sydney",
    "country": "Australia",
    "site": "https://www.sydney.edu.au",
    "slug": "the-university-of-sydney",
    "description": "Founded in 1850, the University of Sydney is Australia's oldest university and a comprehensive public research institution. Its Faculty of Arts and Social Sciences spans the full range of social science disciplines.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "AUD 49,200–81,400/yr (~$32,000–52,900)",
    "tuitionUSD": 42500,
    "tuitionSource": "https://www.sydney.edu.au/study/fees-and-loans/international-student-tuition-fees.html",
    "ibDisplay": "Varies by program (Medicine 42, Law 39-40, Commerce 36-38, Engineering 32-36, Science 30-34)",
    "ibMin": 30,
    "ibMax": 42,
    "ibOfficial": true,
    "ibSource": "https://www.sydney.edu.au/dam/corporate/documents/study/how-to-apply/international-admission-guide.pdf"
  },
  {
    "rank": 27,
    "name": "McGill University",
    "country": "Canada",
    "site": "https://www.mcgill.ca",
    "slug": "mcgill-university",
    "description": "McGill is a public research university in Montreal founded in 1821, consistently ranked among Canada's leading universities. Its Faculty of Arts offers a broad range of social science majors alongside strong political science and economics departments.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "CAD 30,000–65,000/yr (~$21,000–45,500)",
    "tuitionUSD": 33000,
    "tuitionSource": "https://www.mcgill.ca/student-accounts/tuition-fees/tuition-and-fees-tables-and-rates",
    "ibDisplay": "No single minimum; faculty cutoffs 28-41, competitive programs 36-40",
    "ibMin": 28,
    "ibMax": 41,
    "ibOfficial": true,
    "ibSource": "https://www.mcgill.ca/undergraduate-admissions/apply/requirements/international/ib"
  },
  {
    "rank": 28,
    "name": "PSL University",
    "country": "France",
    "site": "https://psl.eu",
    "slug": "psl-university",
    "description": "PSL (Paris Sciences & Lettres) is a federal university formed in 2010 uniting Parisian grandes écoles and research institutes, including École Normale Supérieure and Université Paris-Dauphine. Social science offerings vary sharply by constituent school — strongest in economics and management at Dauphine and the humanities at ENS.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "History"
      }
    ],
    "tuitionDisplay": "~€170–175/yr national-diploma programs; institutional programs ~€2,770–4,170/yr",
    "tuitionUSD": 2000,
    "tuitionSource": "https://psl.eu/sites/default/files/planning_your_budget_en_.pdf",
    "ibDisplay": "Not published university-wide",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 29,
    "name": "University of Toronto",
    "country": "Canada",
    "site": "https://www.utoronto.ca",
    "slug": "university-of-toronto",
    "description": "Founded in 1827, the University of Toronto is Canada's largest university and a leading public research institution. Its Faculty of Arts & Science offers one of the most extensive social science curricula in North America.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "CAD 45,000–70,060/yr (~$31,500–49,000)",
    "tuitionUSD": 40000,
    "tuitionSource": "https://www.registrar.utoronto.ca/fees-payments/tuition-fee-schedules/",
    "ibDisplay": "Not published (no stated point minimum)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://www.artsci.utoronto.ca/future/ready-apply/admission-requirements/international-baccalaureate-ib"
  },
  {
    "rank": 30,
    "name": "Fudan University",
    "country": "China",
    "site": "https://www.fudan.edu.cn",
    "slug": "fudan-university",
    "description": "Fudan University is a public research university in Shanghai founded in 1905, consistently ranked among mainland China's top comprehensive universities. It is particularly strong in economics, journalism, and international relations.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "International Development"
      }
    ],
    "tuitionDisplay": "¥60,000/yr English-medium (~$8,300); Chinese-medium ¥23,000–40,000",
    "tuitionUSD": 6000,
    "tuitionSource": "https://www.shiksha.com/studyabroad/china/universities/fudan-university/fees",
    "ibDisplay": "36 points cited (secondary source only, not confirmed on Fudan's own site)",
    "ibMin": 36,
    "ibMax": 36,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com/university/fudan-university/ib-requirement"
  },
  {
    "rank": 31,
    "name": "King's College London (KCL)",
    "country": "United Kingdom",
    "site": "https://www.kcl.ac.uk",
    "slug": "king-s-college-london-kcl",
    "description": "Part of the federal University of London, King's College London was founded in 1829 and is centrally located in the city. Its Department of War Studies and School of Politics & Economics are internationally renowned for international relations and political science.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£27,100–£61,000/yr",
    "tuitionUSD": 44000,
    "tuitionSource": "https://www.kcl.ac.uk/study/undergraduate/fees-and-funding/tuition-fees",
    "ibDisplay": "Typical range 32-38 points",
    "ibMin": 32,
    "ibMax": 38,
    "ibOfficial": true,
    "ibSource": "https://www.kcl.ac.uk/study/undergraduate/how-to-apply/entry-requirements"
  },
  {
    "rank": 32,
    "name": "Australian National University",
    "country": "Australia",
    "site": "https://www.anu.edu.au",
    "slug": "australian-national-university",
    "description": "ANU is Australia's national research university, founded by the federal government in 1946 in Canberra. Its Coral Bell School of Asia Pacific Affairs and Crawford School of Public Policy make it a regional hub for political science, international relations, and public policy.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "AUD 46,680–62,440/yr (~$30,300–40,600)",
    "tuitionUSD": 35400,
    "tuitionSource": "https://www.anu.edu.au/students/program-administration/fees-payments/international-tuition-fees",
    "ibDisplay": "Minimum 30 points to be eligible",
    "ibMin": 30,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://study.anu.edu.au/apply/indicative-entry-requirement/international-baccalaureate"
  },
  {
    "rank": 32,
    "name": "The Chinese University of Hong Kong",
    "country": "Hong Kong",
    "site": "https://www.cuhk.edu.hk",
    "slug": "the-chinese-university-of-hong-kong",
    "description": "CUHK is a public research university founded in 1963, known for its collegiate system and its Faculty of Social Science, which includes one of the region's most established anthropology departments.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "HKD 214,000/yr (~$27,400)",
    "tuitionUSD": 27400,
    "tuitionSource": "https://international.cuhk.edu.hk/infoguide/fees/",
    "ibDisplay": "Minimum 30 points",
    "ibMin": 30,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://www.cuhk.edu.hk/adm/intl/adm_guide/IB.pdf"
  },
  {
    "rank": 34,
    "name": "University of Edinburgh",
    "country": "United Kingdom",
    "site": "https://www.ed.ac.uk",
    "slug": "university-of-edinburgh",
    "description": "Founded in 1583, Edinburgh is one of Scotland's four ancient universities and a leading UK research institution. Its School of Social and Political Science is one of the largest in the UK.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "From £26,500/yr",
    "tuitionUSD": 33700,
    "tuitionSource": "https://registryservices.ed.ac.uk/tuition-fees/find/undergraduate/2025-2026",
    "ibDisplay": "Typical offers 37-43 points depending on course",
    "ibMin": 37,
    "ibMax": 43,
    "ibOfficial": true,
    "ibSource": "https://study.ed.ac.uk/undergraduate/entry-requirements/international-qualifications/international-baccalaureate"
  },
  {
    "rank": 35,
    "name": "The University of Manchester",
    "country": "United Kingdom",
    "site": "https://www.manchester.ac.uk",
    "slug": "the-university-of-manchester",
    "description": "Manchester traces its roots to 1824 and received its current charter in 2004 after merging with UMIST. Its sociology and social anthropology departments have a long, influential history, including the mid-20th-century 'Manchester School' of anthropology.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£26,000–£39,900/yr",
    "tuitionUSD": 33000,
    "tuitionSource": "https://www.manchester.ac.uk/study/international/finance-and-scholarships/fees/",
    "ibDisplay": "Typical range 30-39 points",
    "ibMin": 30,
    "ibMax": 39,
    "ibOfficial": true,
    "ibSource": "https://www.manchester.ac.uk/study/undergraduate/applying/before-you-apply/entry-requirements/"
  },
  {
    "rank": 36,
    "name": "Monash University",
    "country": "Australia",
    "site": "https://www.monash.edu",
    "slug": "monash-university",
    "description": "Monash is a public research university founded in 1958 in Melbourne, now Australia's largest by enrolment. Its Faculty of Arts covers the full range of social science disciplines across several campuses, including a satellite campus in Malaysia.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "AUD 39,500–101,600/yr (~$25,700–66,000)",
    "tuitionUSD": 45800,
    "tuitionSource": "https://www.monash.edu/study/fees-scholarships",
    "ibDisplay": "No single minimum; competitive programs ~32-36",
    "ibMin": 32,
    "ibMax": 36,
    "ibOfficial": false,
    "ibSource": "https://www.monash.edu/admissions/entry-requirements/minimum"
  },
  {
    "rank": 36,
    "name": "The University of Tokyo",
    "country": "Japan",
    "site": "https://www.u-tokyo.ac.jp",
    "slug": "the-university-of-tokyo",
    "description": "Founded in 1877, the University of Tokyo is Japan's most prestigious national university. Its Faculty of Law and Faculty of Economics are historically the most competitive routes into the Japanese civil service and business elite, alongside a broad Faculty of Letters.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Human Geography"
      }
    ],
    "tuitionDisplay": "¥535,800/yr (~$3,430) + one-time ¥282,000 entrance fee",
    "tuitionUSD": 3430,
    "tuitionSource": "https://www.u-tokyo.ac.jp/en/prospective-students/tuition_fees.html",
    "ibDisplay": "Minimum 38/42 points for the PEAK program (2026 was PEAK's final intake)",
    "ibMin": 38,
    "ibMax": 42,
    "ibOfficial": true,
    "ibSource": "https://peak.c.u-tokyo.ac.jp/vcms_lf/ApplicationGuidelines_2026.pdf"
  },
  {
    "rank": 38,
    "name": "Columbia University",
    "country": "United States",
    "site": "https://www.columbia.edu",
    "slug": "columbia-university",
    "description": "Columbia is a private Ivy League university in New York City, chartered in 1754 as King's College. Undergraduates take its well-known Core Curriculum, and its political science, economics, and sociology departments are longstanding strengths.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$71,170/yr + $350 int'l fee",
    "tuitionUSD": 71170,
    "tuitionSource": "https://undergrad.admissions.columbia.edu/affordability/cost",
    "ibDisplay": "Not published; admitted range ~38-43 (secondary)",
    "ibMin": 38,
    "ibMax": 43,
    "ibOfficial": false,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 38,
    "name": "Seoul National University",
    "country": "South Korea",
    "site": "https://www.snu.ac.kr",
    "slug": "seoul-national-university",
    "description": "SNU is South Korea's flagship national university, founded in 1946 in Seoul. Its College of Social Sciences covers economics, political science, sociology, psychology, anthropology, and geography.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~KRW 5-8M/yr (~$3,800-6,000)",
    "tuitionUSD": 4900,
    "tuitionSource": "https://en.snu.ac.kr/academics/resources/registration",
    "ibDisplay": "Not published; third-party estimate ~37",
    "ibMin": 37,
    "ibMax": 37,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com"
  },
  {
    "rank": 40,
    "name": "University of British Columbia",
    "country": "Canada",
    "site": "https://www.ubc.ca",
    "slug": "university-of-british-columbia",
    "description": "UBC is a public research university in Vancouver founded in 1908, consistently ranked among Canada's top institutions. Its Faculty of Arts offers a broad range of social science majors.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "CAD ~$50,600/yr (~$37,500 USD)",
    "tuitionUSD": 37500,
    "tuitionSource": "https://vancouver.calendar.ubc.ca/admissions/applicants-international-baccalaureate-and-advanced-placement-courses",
    "ibDisplay": "Minimum 24 points",
    "ibMin": 24,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://vancouver.calendar.ubc.ca/admissions/applicants-international-baccalaureate-and-advanced-placement-courses"
  },
  {
    "rank": 41,
    "name": "Institut Polytechnique de Paris",
    "country": "France",
    "site": "https://www.ip-paris.fr",
    "slug": "institut-polytechnique-de-paris",
    "description": "Institut Polytechnique de Paris is a federation of elite French engineering grandes écoles — including École Polytechnique, Télécom Paris, and ENSTA Paris — formed in 2019. Its bachelor's-level offerings are almost entirely engineering and applied science, with economics taught mainly as a component of the engineering curriculum.",
    "programs": [
      {
        "field": "Economics"
      }
    ],
    "tuitionDisplay": "Not found precisely (~£16,800/yr, unverified)",
    "tuitionUSD": 21000,
    "tuitionSource": null,
    "ibDisplay": "Not published (holistic)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": "https://www.ip-paris.fr/en/education/useful-information/admissions"
  },
  {
    "rank": 42,
    "name": "Northwestern University",
    "country": "United States",
    "site": "https://www.northwestern.edu",
    "slug": "northwestern-university",
    "description": "Northwestern is a private research university founded in 1851 near Chicago. Its Medill School is one of the best-known journalism programs in the US, alongside strong political science, economics, and sociology departments in Weinberg College.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$63,468/yr",
    "tuitionUSD": 63468,
    "tuitionSource": "https://admissions.northwestern.edu/tuition-aid",
    "ibDisplay": "Not published; admitted range 42-44",
    "ibMin": 42,
    "ibMax": 44,
    "ibOfficial": false,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 42,
    "name": "The University of Queensland",
    "country": "Australia",
    "site": "https://www.uq.edu.au",
    "slug": "the-university-of-queensland",
    "description": "UQ is a public research university founded in 1909 in Brisbane, one of Australia's largest and most comprehensive universities. Its School of Social Science offers the full range of core social science majors.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "AUD 35,000-50,000/yr",
    "tuitionUSD": 27500,
    "tuitionSource": "https://my.uq.edu.au/information-and-services/manage-my-program/fees-payments-and-refunds/fees-international-students",
    "ibDisplay": "25-42 range by program, ~32 commonly cited",
    "ibMin": 25,
    "ibMax": 42,
    "ibOfficial": true,
    "ibSource": "https://study.uq.edu.au"
  },
  {
    "rank": 44,
    "name": "The Hong Kong University of Science and Technology",
    "country": "Hong Kong",
    "site": "https://www.ust.hk",
    "slug": "the-hong-kong-university-of-science-and-technology",
    "description": "HKUST is a public research university founded in 1991, built primarily around engineering, science, and business. Its Division of Social Science offers a smaller set of programs including economics, global China studies, and public policy.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Sociology"
      }
    ],
    "tuitionDisplay": "HKD 140,000/yr (~$18,000)",
    "tuitionUSD": 18000,
    "tuitionSource": "https://join.hkust.edu.hk/fees-and-scholarships",
    "ibDisplay": "~28+ min, competitive 32-38+",
    "ibMin": 28,
    "ibMax": 38,
    "ibOfficial": false,
    "ibSource": "https://join.hkust.edu.hk/admissions/international-qualifications"
  },
  {
    "rank": 45,
    "name": "University of Michigan-Ann Arbor",
    "country": "United States",
    "site": "https://www.umich.edu",
    "slug": "university-of-michigan-ann-arbor",
    "description": "Michigan is a public research university founded in 1817, one of the US's leading public flagships. Its Institute for Social Research is one of the world's largest social science research organizations, and its College of Literature, Science & the Arts offers an extensive social science curriculum.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$63,000+/yr",
    "tuitionUSD": 63000,
    "tuitionSource": "https://admissions.umich.edu/i-am/international-students",
    "ibDisplay": "Not published; admitted range 38-43",
    "ibMin": 38,
    "ibMax": 43,
    "ibOfficial": false,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 46,
    "name": "University of California, Los Angeles (UCLA)",
    "country": "United States",
    "site": "https://www.ucla.edu",
    "slug": "university-of-california-los-angeles-ucla",
    "description": "UCLA is a public research university founded in 1919, part of the University of California system. Its College of Letters and Science hosts a wide range of social science majors, from political science to gender studies.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$57,242/yr (2026-27)",
    "tuitionUSD": 57242,
    "tuitionSource": "https://admission.ucla.edu/tuition-aid/tuition-fees",
    "ibDisplay": "Not published; 25th-75th percentile 36-42",
    "ibMin": 36,
    "ibMax": 42,
    "ibOfficial": false,
    "ibSource": "https://admission.ucla.edu/admitted-students/ib-credit-the-college"
  },
  {
    "rank": 47,
    "name": "Delft University of Technology",
    "country": "Netherlands",
    "site": "https://www.tudelft.nl",
    "slug": "delft-university-of-technology",
    "description": "TU Delft is the Netherlands' largest and oldest public technical university, founded in 1842. Its bachelor's programs are concentrated in engineering, architecture, and applied sciences; its Technology, Policy and Management faculty applies social-science methods to technology policy without offering standalone social science majors.",
    "programs": [
      {
        "field": "Public Administration & Policy"
      }
    ],
    "tuitionDisplay": "€14,500-22,290/yr",
    "tuitionUSD": 20000,
    "tuitionSource": "https://www.tudelft.nl",
    "ibDisplay": "~30-34 typical, Math AA HL required",
    "ibMin": 30,
    "ibMax": 34,
    "ibOfficial": false,
    "ibSource": "https://www.tudelft.nl/en/education/admission-and-application/bsc-international-diploma/admission-requirements"
  },
  {
    "rank": 47,
    "name": "Shanghai Jiao Tong University",
    "country": "China",
    "site": "https://www.sjtu.edu.cn",
    "slug": "shanghai-jiao-tong-university",
    "description": "SJTU is a public research university in Shanghai founded in 1896, historically strong in engineering and medicine. Its School of International and Public Affairs offers growing undergraduate programs in economics and public policy.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "International Relations"
      }
    ],
    "tuitionDisplay": "RMB 24,800/yr (~$3,400); business ~RMB 80-120k",
    "tuitionUSD": 3400,
    "tuitionSource": "https://gc.sjtu.edu.cn/admission/international-undergraduate-admission/fees-and-scholarships",
    "ibDisplay": "Not fixed; target range 38-45",
    "ibMin": 38,
    "ibMax": 45,
    "ibOfficial": false,
    "ibSource": "https://gc.sjtu.edu.cn"
  },
  {
    "rank": 49,
    "name": "Zhejiang University",
    "country": "China",
    "site": "https://www.zju.edu.cn",
    "slug": "zhejiang-university",
    "description": "Zhejiang University is a public research university in Hangzhou, China, with roots dating to 1897. It is comprehensive across STEM and social sciences, including a College of Media and International Culture and a School of Public Affairs.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "Sociology"
      }
    ],
    "tuitionDisplay": "RMB 28,000-50,000/yr (~$3,900-7,000)",
    "tuitionUSD": 5400,
    "tuitionSource": "https://iczu.zju.edu.cn",
    "ibDisplay": "Minimum 30 points",
    "ibMin": 30,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://ism.zju.edu.cn"
  },
  {
    "rank": 50,
    "name": "Yonsei University",
    "country": "South Korea",
    "site": "https://www.yonsei.ac.kr",
    "slug": "yonsei-university",
    "description": "Founded in 1885 through Christian missionary roots, Yonsei is one of South Korea's oldest and most prestigious private universities, based in Seoul. Its College of Social Sciences is long established, particularly in political science and economics.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~KRW 8.6-17.4M/yr (~$6,300-12,700)",
    "tuitionUSD": 9500,
    "tuitionSource": "https://yonsei.ac.kr/sites/en_sc/down/2025_fee_Undergraduate.pdf",
    "ibDisplay": "Not published; third-party estimate ~27",
    "ibMin": 27,
    "ibMax": 27,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com"
  },
  {
    "rank": 51,
    "name": "University of Bristol",
    "country": "United Kingdom",
    "site": "https://www.bristol.ac.uk",
    "slug": "university-of-bristol",
    "description": "Bristol is a public research university chartered in 1909, tracing to a university college founded in 1876. Its School for Policy Studies and Department of Sociology, Politics and International Studies are well regarded in the UK.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£18,000-30,000/yr",
    "tuitionUSD": 30400,
    "tuitionSource": "https://www.bristol.ac.uk/study/undergraduate/fees-funding",
    "ibDisplay": "32-39 by course, typically 34-38",
    "ibMin": 32,
    "ibMax": 39,
    "ibOfficial": true,
    "ibSource": "https://www.bristol.ac.uk/study/undergraduate/entry-requirements-qualifications"
  },
  {
    "rank": 52,
    "name": "Carnegie Mellon University",
    "country": "United States",
    "site": "https://www.cmu.edu",
    "slug": "carnegie-mellon-university",
    "description": "CMU is a private research university in Pittsburgh founded in 1900, best known for computer science and engineering. Its Dietrich College of Humanities and Social Sciences offers economics, psychology, and a distinctive quantitative policy and decision-science track.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "International Relations"
      }
    ],
    "tuitionDisplay": "~$67,020-69,702/yr",
    "tuitionUSD": 68360,
    "tuitionSource": "https://www.cmu.edu/sfs/tuition/undergraduate",
    "ibDisplay": "Not published; admitted range 42-44",
    "ibMin": 42,
    "ibMax": 44,
    "ibOfficial": false,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 53,
    "name": "The University of Amsterdam",
    "country": "Netherlands",
    "site": "https://www.uva.nl",
    "slug": "the-university-of-amsterdam",
    "description": "The University of Amsterdam traces its origins to 1632 and gained full university status in 1877. Its Faculty of Social and Behavioural Sciences is one of the largest in Europe, spanning political science, sociology, anthropology, communication science, and psychology.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "€9,000-15,000/yr typical",
    "tuitionUSD": 13000,
    "tuitionSource": "https://www.uva.nl/en/education/fees-and-funding/tuition-fees",
    "ibDisplay": "Not fixed; third-party estimate ~36",
    "ibMin": 36,
    "ibMax": 36,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com"
  },
  {
    "rank": 54,
    "name": "The Hong Kong Polytechnic University",
    "country": "Hong Kong",
    "site": "https://www.polyu.edu.hk",
    "slug": "the-hong-kong-polytechnic-university",
    "description": "PolyU is a public university in Hong Kong tracing to a trade school founded in 1937, gaining university status in 1994. Alongside its strengths in design and engineering, its Department of Applied Social Sciences offers social work, sociology, and criminology.",
    "programs": [
      {
        "field": "Social Work"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Public Administration & Policy"
      }
    ],
    "tuitionDisplay": "HKD 200,000/yr (~$25,600)",
    "tuitionUSD": 25600,
    "tuitionSource": "https://www.polyu.edu.hk/study/ug/admissions/international-other-qualifications/international-other-qualifications-tuition-fees",
    "ibDisplay": "Minimum 24 points w/ grade 4+ in 2 HL subjects",
    "ibMin": 24,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://www.polyu.edu.hk/study/ug/admissions/international-other-qualifications/international-other-qualifications-general"
  },
  {
    "rank": 55,
    "name": "New York University (NYU)",
    "country": "United States",
    "site": "https://www.nyu.edu",
    "slug": "new-york-university-nyu",
    "description": "NYU is a private research university founded in 1831 in New York City. Its large College of Arts and Science and Gallatin School support an extensive social science curriculum, including politics, economics, sociology, and media studies.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$60,000-65,000/yr",
    "tuitionUSD": 62500,
    "tuitionSource": null,
    "ibDisplay": "Not published; third-party estimate ~37",
    "ibMin": 37,
    "ibMax": 37,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com"
  },
  {
    "rank": 56,
    "name": "London School of Economics and Political Science (LSE)",
    "country": "United Kingdom",
    "site": "https://www.lse.ac.uk",
    "slug": "london-school-of-economics-and-political-science-lse",
    "description": "Founded in 1895 and part of the University of London, LSE is a university built specifically around the social sciences — it has no engineering or natural science faculty. Its economics, political science, and social policy departments are among the most influential in the world.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£27,500-35,000/yr",
    "tuitionUSD": 39700,
    "tuitionSource": "https://www.lse.ac.uk/study-at-lse/Undergraduate/fees-and-funding",
    "ibDisplay": "37-39 points overall",
    "ibMin": 37,
    "ibMax": 39,
    "ibOfficial": true,
    "ibSource": "https://www.lse.ac.uk/study-at-lse/Undergraduate/Prospective-Students/How-to-Apply/entry-requirements"
  },
  {
    "rank": 57,
    "name": "Kyoto University",
    "country": "Japan",
    "site": "https://www.kyoto-u.ac.jp",
    "slug": "kyoto-university",
    "description": "Kyoto University is Japan's second-oldest national university, founded in 1897. Its Faculty of Law and Faculty of Economics are historically prestigious, alongside a broad Faculty of Letters covering sociology, psychology, and geography.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Human Geography"
      }
    ],
    "tuitionDisplay": "JPY 535,800/yr (~$3,600)",
    "tuitionUSD": 3600,
    "tuitionSource": "https://www.kyoto-u.ac.jp/en/current/how-to/tuition/tuition-and-fees",
    "ibDisplay": "Not fixed; third-party estimate ~33",
    "ibMin": 33,
    "ibMax": 33,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com"
  },
  {
    "rank": 58,
    "name": "Ludwig-Maximilians-Universität München",
    "country": "Germany",
    "site": "https://www.lmu.de",
    "slug": "ludwig-maximilians-universitat-munchen",
    "description": "LMU Munich is one of Germany's oldest and largest universities, founded in 1472. Its Institute for Communication Science and Media Research is one of the most established in Europe, alongside strong political science and sociology departments.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "€0 (no fees), ~€150/semester",
    "tuitionUSD": 300,
    "tuitionSource": null,
    "ibDisplay": "Not published; third-party estimate ~33",
    "ibMin": 33,
    "ibMax": 33,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com"
  },
  {
    "rank": 58,
    "name": "Universiti Malaya (UM)",
    "country": "Malaysia",
    "site": "https://www.um.edu.my",
    "slug": "universiti-malaya-um",
    "description": "Universiti Malaya is Malaysia's oldest university, tracing to a 1905 medical college and formally established under its current name in 1949. Its Faculty of Arts and Social Sciences is the largest and oldest of its kind in the country.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "RM 29,800-76,000+/yr",
    "tuitionUSD": 11500,
    "tuitionSource": "https://study.um.edu.my",
    "ibDisplay": "Varies by faculty: Science 30 min, some business 28 min",
    "ibMin": 28,
    "ibMax": 30,
    "ibOfficial": true,
    "ibSource": "https://fs.um.edu.my"
  },
  {
    "rank": 60,
    "name": "KU Leuven",
    "country": "Belgium",
    "site": "https://www.kuleuven.be",
    "slug": "ku-leuven",
    "description": "KU Leuven, founded in 1425, is one of the oldest universities in the world and the largest in Belgium. Its Faculty of Social Sciences covers political science, sociology, communication science, and social work.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~€9,494/yr",
    "tuitionUSD": 10300,
    "tuitionSource": "https://www.kuleuven.be/english/education/student/fees",
    "ibDisplay": "Not fixed; generally 30-34",
    "ibMin": 30,
    "ibMax": 34,
    "ibOfficial": false,
    "ibSource": "https://www.kuleuven.be"
  },
  {
    "rank": 61,
    "name": "Korea University",
    "country": "South Korea",
    "site": "https://www.korea.ac.kr",
    "slug": "korea-university",
    "description": "Korea University is a private research university in Seoul founded in 1905, traditionally one of Korea's 'SKY' universities alongside Seoul National and Yonsei. Its College of Political Science and Economics is especially prominent.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~KRW 11.6-15.6M/yr (~$8,500-11,400)",
    "tuitionUSD": 10000,
    "tuitionSource": "https://oia.korea.ac.kr/oia/under/Tuition.do",
    "ibDisplay": "Not published; third-party estimate ~30",
    "ibMin": 30,
    "ibMax": 30,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com"
  },
  {
    "rank": 62,
    "name": "Duke University",
    "country": "United States",
    "site": "https://www.duke.edu",
    "slug": "duke-university",
    "description": "Duke is a private research university in Durham, North Carolina, founded as Trinity College in 1838 and renamed Duke in 1924. Its Sanford School of Public Policy and strong economics and political science departments anchor its social science offerings.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "$67,320-70,265/yr",
    "tuitionUSD": 68800,
    "tuitionSource": "https://finance.duke.edu/bursar/TuitionFees/tuition",
    "ibDisplay": "Not published; admitted range 43-44",
    "ibMin": 43,
    "ibMax": 44,
    "ibOfficial": false,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 63,
    "name": "City University of Hong Kong",
    "country": "Hong Kong",
    "site": "https://www.cityu.edu.hk",
    "slug": "city-university-of-hong-kong",
    "description": "City University of Hong Kong was founded in 1984 and gained university status in 1994, built around applied and professional education. Its Department of Social and Behavioural Sciences offers applied social sciences, public policy, and criminology.",
    "programs": [
      {
        "field": "Sociology"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Psychology"
      }
    ],
    "tuitionDisplay": "HKD 190,000/yr (~$24,400)",
    "tuitionUSD": 24400,
    "tuitionSource": "https://www.cityu.edu.hk/international/fees-scholarships/fees",
    "ibDisplay": "Minimum 30 points (out of 45, Advanced Standing I)",
    "ibMin": 30,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://www.cityu.edu.hk/admo/admissions/international-admissions"
  },
  {
    "rank": 63,
    "name": "National Taiwan University (NTU)",
    "country": "Taiwan",
    "site": "https://www.ntu.edu.tw",
    "slug": "national-taiwan-university-ntu",
    "description": "National Taiwan University was founded in 1928 as Taihoku Imperial University and renamed after 1945. It is Taiwan's leading comprehensive university, with a College of Social Sciences covering economics, political science, sociology, and social work.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "NT$58,000-168,000/yr (~$1,900-5,500)",
    "tuitionUSD": 3700,
    "tuitionSource": "https://isss.ntu.edu.tw/finances/tuition-fees",
    "ibDisplay": "Not fixed; third-party estimate ~37",
    "ibMin": 37,
    "ibMax": 37,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com"
  },
  {
    "rank": 65,
    "name": "The University of Auckland",
    "country": "New Zealand",
    "site": "https://www.auckland.ac.nz",
    "slug": "the-university-of-auckland",
    "description": "The University of Auckland was founded in 1883 and is New Zealand's largest university. Its Faculty of Arts offers the full range of core social science majors.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "Varies by faculty (no single figure)",
    "tuitionUSD": 30000,
    "tuitionSource": "https://www.auckland.ac.nz/en/study/fees-and-money-matters/tuition-fees/international-student-fees/undergraduate-international-fees.html",
    "ibDisplay": "Minimum 24 points (University Entrance standard)",
    "ibMin": 24,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://www.auckland.ac.nz"
  },
  {
    "rank": 66,
    "name": "University of California, San Diego (UCSD)",
    "country": "United States",
    "site": "https://www.ucsd.edu",
    "slug": "university-of-california-san-diego-ucsd",
    "description": "UC San Diego is a public research university founded in 1960, part of the University of California system. Its School of Social Sciences includes economics, political science, and one of the largest psychology departments in the US.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$47,874/yr (2025-26)",
    "tuitionUSD": 47874,
    "tuitionSource": "https://admissions.ucsd.edu/why/cost-aid",
    "ibDisplay": "Not published; admitted range 35-41",
    "ibMin": 35,
    "ibMax": 41,
    "ibOfficial": false,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 67,
    "name": "King Fahd University of Petroleum & Minerals",
    "country": "Saudi Arabia",
    "site": "https://www.kfupm.edu.sa",
    "slug": "king-fahd-university-of-petroleum-minerals",
    "description": "KFUPM is a public university in Dhahran, Saudi Arabia, founded in 1963, built specifically around engineering, petroleum, and applied science education. It does not offer social science bachelor's degrees.",
    "programs": [],
    "noProgramsNote": "This university's undergraduate offerings are concentrated in engineering and the natural sciences; it has no dedicated social science bachelor's programs.",
    "tuitionDisplay": "Not found reliably (mostly funds Saudi/scholarship students)",
    "tuitionUSD": null,
    "tuitionSource": null,
    "ibDisplay": "Not published; third-party estimate ~27",
    "ibMin": 27,
    "ibMax": 27,
    "ibOfficial": false,
    "ibSource": "https://www.gotouniversity.com"
  },
  {
    "rank": 68,
    "name": "University of Texas at Austin",
    "country": "United States",
    "site": "https://www.utexas.edu",
    "slug": "university-of-texas-at-austin",
    "description": "UT Austin is Texas's public flagship university, founded in 1883. Its College of Liberal Arts is one of the largest in the US, with well-regarded government, economics, and sociology departments.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$38,650-51,106/yr (~$42,778 common)",
    "tuitionUSD": 42778,
    "tuitionSource": "https://admissions.utexas.edu/cost-aid/cost-tuition-rates",
    "ibDisplay": "Not published; admitted range 35-41, avg 38",
    "ibMin": 35,
    "ibMax": 41,
    "ibOfficial": false,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 69,
    "name": "Brown University",
    "country": "United States",
    "site": "https://www.brown.edu",
    "slug": "brown-university",
    "description": "Brown is a private Ivy League university in Providence, Rhode Island, founded in 1764. Its Open Curriculum gives undergraduates unusual freedom to combine social science concentrations, and its Watson Institute anchors strong international and public affairs offerings.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "$74,650/yr (2025-26)",
    "tuitionUSD": 74650,
    "tuitionSource": "https://admission.brown.edu/tuition-aid/tuition-fees",
    "ibDisplay": "Not published; admitted range 42-44",
    "ibMin": 42,
    "ibMax": 44,
    "ibOfficial": false,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 70,
    "name": "Université Paris-Saclay",
    "country": "France",
    "site": "https://www.universite-paris-saclay.fr",
    "slug": "universite-paris-saclay",
    "description": "Université Paris-Saclay is a cluster university south of Paris formed in 2019 from several grandes écoles and the former Université Paris-Sud. It is predominantly a science and engineering institution, with economics and some social science taught through its university college component.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Sociology"
      }
    ],
    "tuitionDisplay": "~€170-2,770/yr (partial waiver)",
    "tuitionUSD": 1200,
    "tuitionSource": "https://www.universite-paris-saclay.fr/en/admission/tuition-fees",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 70,
    "name": "University of Illinois at Urbana-Champaign",
    "country": "United States",
    "site": "https://illinois.edu",
    "slug": "university-of-illinois-at-urbana-champaign",
    "description": "UIUC is Illinois's public flagship university, founded in 1867. Its College of Liberal Arts & Sciences offers an extensive social science curriculum spanning political science, economics, sociology, and communication.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$33,560-44,688/yr",
    "tuitionUSD": 39100,
    "tuitionSource": "https://www.admissions.illinois.edu/invest/tuition",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 72,
    "name": "Lund University",
    "country": "Sweden",
    "site": "https://www.lu.se",
    "slug": "lund-university",
    "description": "Lund University, founded in 1666, is one of Scandinavia's oldest and largest universities. Its Faculty of Social Sciences covers political science, sociology, psychology, and human geography.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "SEK 135,000-170,000/yr (~$13,000-16,000)",
    "tuitionUSD": 14500,
    "tuitionSource": "https://www.lunduniversity.lu.se/study/bachelors-and-masters-studies/applying-studies-when-apply/tuition-fees",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 72,
    "name": "Sorbonne University (merged from Paris IV & UPMC)",
    "country": "France",
    "site": "https://www.sorbonne-universite.fr",
    "slug": "sorbonne-university-merged-from-paris-iv-upmc",
    "description": "This Sorbonne University was formed in 2018 by merging the humanities-focused Paris-Sorbonne (Paris IV) with the science-focused UPMC. Its Faculty of Humanities covers history, linguistics, and geography, though the classic Parisian social sciences (economics, sociology, political science) sit mainly at the separate Panthéon-Sorbonne.",
    "programs": [
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Human Geography"
      }
    ],
    "tuitionDisplay": "~€2,770/yr avg (partial exemption)",
    "tuitionUSD": 3000,
    "tuitionSource": "https://www.sorbonne-universite.fr/en/information-international-students",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 74,
    "name": "The University of Warwick",
    "country": "United Kingdom",
    "site": "https://warwick.ac.uk",
    "slug": "the-university-of-warwick",
    "description": "Warwick is a public research university founded in 1965 near Coventry, England. Its Department of Politics and International Studies and its economics department are among the most selective in the UK.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£24,800-47,450/yr",
    "tuitionUSD": 46000,
    "tuitionSource": "https://warwick.ac.uk/services/finance/studentfinance/fees/overseasfees/",
    "ibDisplay": "36-38 points, most courses",
    "ibMin": 36,
    "ibMax": 38,
    "ibOfficial": true,
    "ibSource": "https://warwick.ac.uk/study/undergraduate/courses/ug-international-qualifications/"
  },
  {
    "rank": 75,
    "name": "Trinity College Dublin, The University of Dublin",
    "country": "Ireland",
    "site": "https://www.tcd.ie",
    "slug": "trinity-college-dublin-the-university-of-dublin",
    "description": "Trinity College Dublin, founded in 1592, is Ireland's oldest university. Its School of Social Sciences and Philosophy covers political science, sociology, and social policy.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "€26,500-33,000/yr",
    "tuitionUSD": 32000,
    "tuitionSource": "https://www.tcd.ie/courses/undergraduate/fees/",
    "ibDisplay": "28-40 by course (min 3 HL@5 + 3 SL@4)",
    "ibMin": 28,
    "ibMax": 40,
    "ibOfficial": true,
    "ibSource": "https://www.tcd.ie/study/assets/PDF/TCD_NonEU_IBQuick_Guide.pdf"
  },
  {
    "rank": 76,
    "name": "University of Birmingham",
    "country": "United Kingdom",
    "site": "https://www.birmingham.ac.uk",
    "slug": "university-of-birmingham",
    "description": "Birmingham was the first English 'redbrick' university to receive a royal charter, in 1900. Its Department of Political Science and International Studies (POLSIS) is one of the largest and longest-established in the UK.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£22,850-50,360/yr",
    "tuitionUSD": 39000,
    "tuitionSource": "https://www.birmingham.ac.uk/study/international/fees",
    "ibDisplay": "Not published (UK main campus)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 77,
    "name": "The University of Western Australia",
    "country": "Australia",
    "site": "https://www.uwa.edu.au",
    "slug": "the-university-of-western-australia",
    "description": "UWA is a public research university founded in 1911 in Perth, Western Australia's oldest university. Its School of Social Sciences covers the core social science disciplines.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "AUD 32,000-48,000/yr",
    "tuitionUSD": 26000,
    "tuitionSource": "https://www.uwa.edu.au/study/scholarships-and-fees/international-student-fees",
    "ibDisplay": "~24 points (IBO recognition statement)",
    "ibMin": 24,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 78,
    "name": "KTH Royal Institute of Technology",
    "country": "Sweden",
    "site": "https://www.kth.se",
    "slug": "kth-royal-institute-of-technology",
    "description": "KTH is Sweden's largest technical university, founded in 1827 in Stockholm. Its bachelor's programs are concentrated in engineering and architecture; it offers no standalone social science majors, though its architecture school includes urban planning and design.",
    "programs": [
      {
        "field": "Urban Studies & Planning"
      }
    ],
    "tuitionDisplay": "SEK ~141,000/yr (ICT bachelor's, only English-taught one)",
    "tuitionUSD": 13300,
    "tuitionSource": "https://www.kth.se/en/studies/bachelor/fees-1.646274",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 79,
    "name": "University of Glasgow",
    "country": "United Kingdom",
    "site": "https://www.gla.ac.uk",
    "slug": "university-of-glasgow",
    "description": "Founded in 1451, Glasgow is one of Scotland's four ancient universities. Its School of Social and Political Sciences covers sociology, politics, and social policy.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£22,600-31,800/yr",
    "tuitionUSD": 34500,
    "tuitionSource": "https://www.gla.ac.uk/undergraduate/fees/intlfees/",
    "ibDisplay": "38 points (6,6,6 HL) standard",
    "ibMin": 38,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://www.gla.ac.uk/undergraduate/fees/"
  },
  {
    "rank": 80,
    "name": "Ruprecht-Karls-Universität Heidelberg",
    "country": "Germany",
    "site": "https://www.uni-heidelberg.de",
    "slug": "ruprecht-karls-universitat-heidelberg",
    "description": "Heidelberg University, founded in 1386, is Germany's oldest university. Its Max Weber Institute for Sociology and its political science faculty are longstanding strengths.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~€3,000-3,400/yr incl. semester fee",
    "tuitionUSD": 3200,
    "tuitionSource": "https://www.uni-heidelberg.de/en/study/management-of-studies/semester-fees/tuition-fees-for-international-students",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 81,
    "name": "University of Washington",
    "country": "United States",
    "site": "https://www.washington.edu",
    "slug": "university-of-washington",
    "description": "UW is a public research university founded in 1861 in Seattle. Its Jackson School of International Studies and its economics and political science departments anchor a broad social science offering.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$44,456/yr",
    "tuitionUSD": 44456,
    "tuitionSource": "https://www.washington.edu/opb/tuition-fees/estimated-annual-cost-of-attendance-for-first-year-undergraduates/",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 82,
    "name": "Adelaide University",
    "country": "Australia",
    "site": "https://www.adelaide.edu.au",
    "slug": "adelaide-university",
    "description": "Adelaide University was founded in 1874 and took its current form in 2024 through the merger of the University of Adelaide and the University of South Australia. It offers a comprehensive range of social science majors.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "AUD 42,500-60,000/yr",
    "tuitionUSD": 33900,
    "tuitionSource": "https://international.adelaide.edu.au/admissions/university-fees",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 82,
    "name": "Pennsylvania State University",
    "country": "United States",
    "site": "https://www.psu.edu",
    "slug": "pennsylvania-state-university",
    "description": "Penn State is a public research university founded in 1855, one of the US's largest by enrolment. Its College of the Liberal Arts covers the core social science disciplines, including a large sociology and criminology department.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~$44,996-46,899/yr",
    "tuitionUSD": 45950,
    "tuitionSource": "https://www.psu.edu/admission/undergraduate/tuition-costs",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 84,
    "name": "Universidad de Buenos Aires",
    "country": "Argentina",
    "site": "https://www.uba.ar",
    "slug": "universidad-de-buenos-aires",
    "description": "UBA, founded in 1821, is the largest and most influential public university in Latin America. Its Faculty of Social Sciences has produced many of the region's leading sociologists and political scientists, and admission is via a free, open first-year program (CBC) rather than selective entry.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "Free / no tuition fee",
    "tuitionUSD": 0,
    "tuitionSource": "https://www.unipage.net/en/626/university_of_buenos_aires",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 85,
    "name": "Tokyo Institute of Technology",
    "country": "Japan",
    "site": "https://www.titech.ac.jp",
    "slug": "tokyo-institute-of-technology",
    "description": "Tokyo Institute of Technology, founded in 1881, is Japan's leading science and engineering university (it merged with Tokyo Medical and Dental University in 2024 to form Institute of Science Tokyo). Its undergraduate offerings are concentrated in engineering and science, with only general-education humanities and social science courses rather than dedicated majors.",
    "programs": [],
    "noProgramsNote": "This university's undergraduate offerings are concentrated in engineering and the natural sciences; it has no dedicated social science bachelor's programs.",
    "tuitionDisplay": "¥535,800/yr (~$3,700)",
    "tuitionUSD": 3700,
    "tuitionSource": "https://www.titech.ac.jp/english/student-support/prospective-students/tutiton",
    "ibDisplay": "Not published (unofficial ~33)",
    "ibMin": 33,
    "ibMax": 33,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 86,
    "name": "University of Leeds",
    "country": "United Kingdom",
    "site": "https://www.leeds.ac.uk",
    "slug": "university-of-leeds",
    "description": "Leeds traces to a college founded in 1874 and received its university charter in 1904. Its School of Sociology and Social Policy and School of Politics and International Studies are well established in the UK.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£19,000-47,000/yr",
    "tuitionUSD": 38300,
    "tuitionSource": "https://www.leeds.ac.uk/international-fees-costs",
    "ibDisplay": "35 points overall cited, 17 from HL (lower confidence)",
    "ibMin": 35,
    "ibMax": 35,
    "ibOfficial": false,
    "ibSource": "https://www.leeds.ac.uk/undergraduate-fees/doc/fees-undergraduate-fees"
  },
  {
    "rank": 87,
    "name": "University of Southampton",
    "country": "United Kingdom",
    "site": "https://www.southampton.ac.uk",
    "slug": "university-of-southampton",
    "description": "Southampton was founded as the Hartley Institution in 1862 and gained university status in 1952. It is particularly noted for social statistics and demography within its Faculty of Social Sciences.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£23,400-33,900/yr",
    "tuitionUSD": 36400,
    "tuitionSource": "https://www.southampton.ac.uk/courses/fees/international.page",
    "ibDisplay": "28-38 by program",
    "ibMin": 28,
    "ibMax": 38,
    "ibOfficial": true,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 88,
    "name": "Boston University",
    "country": "United States",
    "site": "https://www.bu.edu",
    "slug": "boston-university",
    "description": "BU is a private research university founded in 1839, based in Boston. Its Pardee School of Global Studies and College of Arts & Sciences support a broad social science curriculum.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "$65,168/yr tuition",
    "tuitionUSD": 65168,
    "tuitionSource": "https://www.bu.edu/admissions/admitted/tuition-and-fees/",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 88,
    "name": "Freie Universität Berlin",
    "country": "Germany",
    "site": "https://www.fu-berlin.de",
    "slug": "freie-universitat-berlin",
    "description": "Freie Universität Berlin was founded in 1948 in West Berlin as a democratic alternative to the Soviet-controlled Humboldt University. Its Otto Suhr Institute for Political Science is one of Germany's largest and most influential.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "No fee, ~€300-330/semester",
    "tuitionUSD": 700,
    "tuitionSource": null,
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 88,
    "name": "Purdue University",
    "country": "United States",
    "site": "https://www.purdue.edu",
    "slug": "purdue-university",
    "description": "Purdue is a public land-grant research university founded in 1869 in Indiana, best known for engineering and agriculture. Its College of Liberal Arts offers core social science majors including political science, economics, sociology, and psychology.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Public Administration & Policy"
      }
    ],
    "tuitionDisplay": "~$28,794/yr",
    "tuitionUSD": 28794,
    "tuitionSource": "https://www.purdue.edu/treasurer/finance/bursar-office/tuition/fee-rates-2025-2026/",
    "ibDisplay": "Explicitly no overall minimum score requirement",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://admissions.purdue.edu/become-student/international/"
  },
  {
    "rank": 91,
    "name": "The University of Osaka",
    "country": "Japan",
    "site": "https://www.osaka-u.ac.jp",
    "slug": "the-university-of-osaka",
    "description": "Osaka University was founded in 1931 and is one of Japan's leading national universities. Its School of Human Sciences and School of Law and Politics cover sociology, psychology, education, and political science.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Human Geography"
      }
    ],
    "tuitionDisplay": "¥535,800/yr (~$3,700)",
    "tuitionUSD": 3700,
    "tuitionSource": "https://www.osaka-u.ac.jp/en/campus/tuition/tuition.html",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 92,
    "name": "The University of Sheffield",
    "country": "United Kingdom",
    "site": "https://www.sheffield.ac.uk",
    "slug": "the-university-of-sheffield",
    "description": "Sheffield received its royal charter in 1905, building on a university college founded in 1897. Its Department of Politics and Department of Sociological Studies are well established in the UK.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£23,810-30,570/yr",
    "tuitionUSD": 34700,
    "tuitionSource": "https://sheffield.ac.uk/international/fees-and-funding/tuition-fees",
    "ibDisplay": "Not published (unofficial ~33)",
    "ibMin": 33,
    "ibMax": 33,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 93,
    "name": "Uppsala University",
    "country": "Sweden",
    "site": "https://www.uu.se",
    "slug": "uppsala-university",
    "description": "Uppsala, founded in 1477, is the oldest university in Scandinavia. Its Department of Peace and Conflict Research is internationally renowned within a broad social science faculty.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "SEK 100,000-144,000/yr",
    "tuitionUSD": 11500,
    "tuitionSource": "https://www.uu.se/en/students/student-life/student-finance/tuition-fees",
    "ibDisplay": "Not published (unofficial ~33)",
    "ibMin": 33,
    "ibMax": 33,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 94,
    "name": "Durham University",
    "country": "United Kingdom",
    "site": "https://www.durham.ac.uk",
    "slug": "durham-university",
    "description": "Durham was founded in 1832 and is England's third-oldest university, with a collegiate system modelled loosely on Oxford and Cambridge. Its School of Government and International Affairs is a notable strength.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£22,000-35,000/yr",
    "tuitionUSD": 36200,
    "tuitionSource": "https://www.durham.ac.uk/study/international/fees-and-funding-/",
    "ibDisplay": "34-38 by program",
    "ibMin": 34,
    "ibMax": 38,
    "ibOfficial": true,
    "ibSource": "https://recognition.ibo.org"
  },
  {
    "rank": 94,
    "name": "University of Alberta",
    "country": "Canada",
    "site": "https://www.ualberta.ca",
    "slug": "university-of-alberta",
    "description": "The University of Alberta is a public research university founded in 1908 in Edmonton, Canada. Its Faculty of Arts offers a broad range of social science majors.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "~CAD 29,000-40,000/yr",
    "tuitionUSD": 24200,
    "tuitionSource": "https://www.ualberta.ca/en/admissions/tuition-and-scholarships/international-tuition-and-fees.html",
    "ibDisplay": "Competitive scores 30-37 (not a strict minimum)",
    "ibMin": 30,
    "ibMax": 37,
    "ibOfficial": false,
    "ibSource": "https://www.ualberta.ca/en/admissions/how-to-apply/ib-students/index.html"
  },
  {
    "rank": 96,
    "name": "University of Technology Sydney",
    "country": "Australia",
    "site": "https://www.uts.edu.au",
    "slug": "university-of-technology-sydney",
    "description": "UTS traces its roots to technical institutes founded in the 1870s and took its current form in 1988. It is built around applied and professional education, with a Faculty of Arts and Social Sciences focused on communication, international studies, and social and political sciences.",
    "programs": [
      {
        "field": "Communication Studies"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "International Development"
      }
    ],
    "tuitionDisplay": "AUD 23,616-56,700/yr",
    "tuitionUSD": 26100,
    "tuitionSource": "https://www.uts.edu.au/for-students/admissions-entry/fees-costs/international-fees",
    "ibDisplay": "~23-24 cited, not independently confirmed official",
    "ibMin": 23,
    "ibMax": 24,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 97,
    "name": "The University of Nottingham",
    "country": "United Kingdom",
    "site": "https://www.nottingham.ac.uk",
    "slug": "the-university-of-nottingham",
    "description": "Nottingham traces to a university college founded in 1881 and received its royal charter in 1948. Its School of Politics and International Relations is well established, alongside a broad School of Sociology and Social Policy.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "£9,250-30,750/yr",
    "tuitionUSD": 27000,
    "tuitionSource": "https://www.nottingham.ac.uk/fees/tuition-fees-student-services.aspx",
    "ibDisplay": "Not published (35 cited only by unreliable secondary source)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 98,
    "name": "Karlsruhe Institute of Technology (KIT)",
    "country": "Germany",
    "site": "https://www.kit.edu",
    "slug": "karlsruhe-institute-of-technology-kit",
    "description": "KIT was formed in 2009 by merging the University of Karlsruhe (founded 1825) with a national research center. It is a pure technical university with no dedicated social science bachelor's programs, though economics is taught within its industrial engineering degree.",
    "programs": [
      {
        "field": "Economics"
      }
    ],
    "tuitionDisplay": "~€3,300/yr incl. admin fee",
    "tuitionUSD": 3500,
    "tuitionSource": "https://www.intl.kit.edu/istudies/12606.php",
    "ibDisplay": "Not published",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 98,
    "name": "Politecnico di Milano",
    "country": "Italy",
    "site": "https://www.polimi.it",
    "slug": "politecnico-di-milano",
    "description": "Politecnico di Milano, founded in 1863, is Italy's largest technical university, built around engineering, architecture, and design. It has no standalone social science majors, but its renowned architecture faculty includes urban planning.",
    "programs": [
      {
        "field": "Urban Studies & Planning"
      }
    ],
    "tuitionDisplay": "€900-4,000/yr income-banded",
    "tuitionUSD": 3100,
    "tuitionSource": "https://www.polimi.it/en/students/tuition-fees-scholarships-and-financial-aid/tuition-fees",
    "ibDisplay": "Not published (27 cited only by unreliable secondary source)",
    "ibMin": null,
    "ibMax": null,
    "ibOfficial": false,
    "ibSource": null
  },
  {
    "rank": 100,
    "name": "University of Zurich (UZH)",
    "country": "Switzerland",
    "site": "https://www.uzh.ch",
    "slug": "university-of-zurich-uzh",
    "description": "UZH is Switzerland's largest university, founded in 1833. Its Faculty of Arts and Social Sciences includes one of Europe's largest psychology departments alongside political science, sociology, and economics.",
    "programs": [
      {
        "field": "Economics"
      },
      {
        "field": "Political Science"
      },
      {
        "field": "Sociology"
      },
      {
        "field": "Psychology"
      },
      {
        "field": "Anthropology"
      },
      {
        "field": "International Relations"
      },
      {
        "field": "Communication Studies"
      },
      {
        "field": "History"
      },
      {
        "field": "Linguistics"
      },
      {
        "field": "Criminology & Criminal Justice"
      },
      {
        "field": "Human Geography"
      },
      {
        "field": "Social Work"
      },
      {
        "field": "Public Administration & Policy"
      },
      {
        "field": "Urban Studies & Planning"
      },
      {
        "field": "International Development"
      },
      {
        "field": "Gender, Sexuality & Women's Studies"
      }
    ],
    "tuitionDisplay": "CHF 1,600-4,000/yr",
    "tuitionUSD": 3150,
    "tuitionSource": "https://www.uzh.ch/en/studies/application/fees.html",
    "ibDisplay": "Minimum 32/42 points (excl. core), 3 HL incl. Math or science",
    "ibMin": 32,
    "ibMax": null,
    "ibOfficial": true,
    "ibSource": "https://recognition.ibo.org"
  }
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

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

universities.forEach(u => { u.slug = u.slug || slugify(u.name); });
const universityBySlug = new Map(universities.map(u => [u.slug, u]));

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

const CONTINENT_BY_COUNTRY = {
  "United States": "North America",
  "Canada": "North America",
  "Argentina": "South America",
  "United Kingdom": "Europe",
  "Switzerland": "Europe",
  "Germany": "Europe",
  "France": "Europe",
  "Netherlands": "Europe",
  "Sweden": "Europe",
  "Belgium": "Europe",
  "Ireland": "Europe",
  "Italy": "Europe",
  "Singapore": "Asia",
  "Hong Kong": "Asia",
  "China": "Asia",
  "Japan": "Asia",
  "South Korea": "Asia",
  "Taiwan": "Asia",
  "Malaysia": "Asia",
  "Saudi Arabia": "Asia",
  "Australia": "Oceania",
  "New Zealand": "Oceania",
};

function continentOf(country) {
  return CONTINENT_BY_COUNTRY[country] || "Other";
}

// ---------- Flatten universities' programs into individual program entries ----------

const programEntries = [];
universities.forEach(u => {
  (u.programs || []).forEach(p => {
    const programName = p.programName || p.field;
    programEntries.push({
      slug: `${u.slug}--${slugify(programName)}`,
      university: u,
      field: p.field,
      programName,
      competitiveness: p.competitiveness || null,
      sourceUrl: p.sourceUrl || null,
    });
  });
});
const programEntryBySlug = new Map(programEntries.map(e => [e.slug, e]));

// ---------- IB score estimation ----------

function estimateIBFromAcceptanceRate(rateStr) {
  if (!rateStr) return null;
  const match = rateStr.match(/([\d.]+)\s*%/);
  if (!match) return null;
  const rate = parseFloat(match[1]);
  if (rate < 5) return { min: 42, max: 45 };
  if (rate < 15) return { min: 38, max: 41 };
  if (rate < 30) return { min: 34, max: 37 };
  if (rate < 50) return { min: 30, max: 33 };
  return { min: 26, max: 29 };
}

function effectiveIBRange(u) {
  if (u.ibMin != null) {
    return {
      min: u.ibMin,
      max: u.ibMax != null ? u.ibMax : u.ibMin,
      official: !!u.ibOfficial,
      source: u.ibSource,
      display: u.ibDisplay,
      estimated: false,
    };
  }
  const est = estimateIBFromAcceptanceRate(u.overallAcceptanceRate);
  if (est) {
    return {
      min: est.min,
      max: est.max,
      official: false,
      source: u.overallAcceptanceSource,
      display: `Estimated from this university's overall acceptance rate (${u.overallAcceptanceRate})`,
      estimated: true,
    };
  }
  return null;
}

// ---------- IB subject list ----------

const IB_SUBJECT_GROUPS = [
  {
    group: "Studies in Language & Literature",
    subjects: ["English A: Literature", "English A: Language and Literature", "Spanish A: Literature", "French A: Literature", "Literature and Performance", "Other Language A"],
  },
  {
    group: "Language Acquisition",
    subjects: ["English B", "French B", "Spanish B", "German B", "Mandarin B", "English Ab Initio", "French Ab Initio", "Spanish Ab Initio", "Other Language B"],
  },
  {
    group: "Individuals & Societies",
    subjects: ["Business Management", "Economics", "Geography", "History", "Philosophy", "Psychology", "Global Politics", "Social and Cultural Anthropology", "Digital Society", "World Religions"],
  },
  {
    group: "Sciences",
    subjects: ["Biology", "Chemistry", "Physics", "Computer Science", "Design Technology", "Environmental Systems and Societies", "Sports, Exercise and Health Science"],
  },
  {
    group: "Mathematics",
    subjects: ["Mathematics: Analysis and Approaches", "Mathematics: Applications and Interpretation"],
  },
  {
    group: "The Arts",
    subjects: ["Visual Arts", "Music", "Theatre", "Film", "Dance"],
  },
];

function subjectOptionsHtml(selected) {
  return `<option value="">Choose a subject</option>` + IB_SUBJECT_GROUPS.map(g => `
    <optgroup label="${g.group}">
      ${g.subjects.map(s => `<option value="${s}" ${selected === s ? "selected" : ""}>${s}</option>`).join("")}
    </optgroup>
  `).join("");
}

// ---------- Wizard state ----------

const wizardState = {
  step: 1,
  subjects: [],
  corePoints: 0,
  interests: new Set(),
  filters: { continent: "", country: "", rankMax: "", tuition: "" },
};

let currentMatches = [];

function totalIBPoints() {
  const subjectSum = wizardState.subjects.reduce((sum, s) => sum + (s && s.grade ? s.grade : 0), 0);
  return subjectSum + Number(wizardState.corePoints || 0);
}

function hasIBProfile() {
  return wizardState.subjects.some(s => s && s.grade);
}

// ---------- Wizard: subjects step ----------

function renderSubjectColumn(container, index, level) {
  if (!wizardState.subjects[index]) wizardState.subjects[index] = { name: "", level, grade: null };
  const s = wizardState.subjects[index];
  s.level = level;
  const col = document.createElement("div");
  col.className = "subject-column";
  col.innerHTML = `
    <select class="subject-name">${subjectOptionsHtml(s.name)}</select>
    <select class="subject-grade">
      <option value="">Grade</option>
      ${[7, 6, 5, 4, 3, 2, 1].map(g => `<option value="${g}" ${s.grade === g ? "selected" : ""}>${g}</option>`).join("")}
    </select>
  `;
  const nameSelect = col.querySelector(".subject-name");
  const gradeSelect = col.querySelector(".subject-grade");
  nameSelect.addEventListener("change", () => { wizardState.subjects[index].name = nameSelect.value; });
  gradeSelect.addEventListener("change", () => {
    wizardState.subjects[index].grade = gradeSelect.value ? Number(gradeSelect.value) : null;
    updateWizardTotal();
  });
  container.appendChild(col);
}

function renderSubjectGrid() {
  const hlGrid = document.getElementById("subject-grid-hl");
  const slGrid = document.getElementById("subject-grid-sl");
  hlGrid.innerHTML = "";
  slGrid.innerHTML = "";
  for (let i = 0; i < 3; i++) renderSubjectColumn(hlGrid, i, "HL");
  for (let i = 3; i < 6; i++) renderSubjectColumn(slGrid, i, "SL");
  updateWizardTotal();
}

function updateWizardTotal() {
  const el = document.getElementById("wizard-total");
  if (el) el.textContent = `Running total: ${totalIBPoints()} / 45`;
}

// ---------- Wizard: interests step ----------

function renderInterestGrid() {
  const grid = document.getElementById("interest-grid");
  grid.innerHTML = bachelorFields.map(f => `
    <label class="interest-chip">
      <input type="checkbox" value="${f.name}" ${wizardState.interests.has(f.name) ? "checked" : ""}>
      <span>${f.name}</span>
    </label>
  `).join("");
  grid.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) wizardState.interests.add(cb.value);
      else wizardState.interests.delete(cb.value);
    });
  });
}

// ---------- Wizard: filters step ----------

function populateCountrySelect() {
  const countrySelect = document.getElementById("filter-country");
  const current = countrySelect.value;
  countrySelect.innerHTML = `<option value="">Any country</option>`;
  const countries = wizardState.filters.continent
    ? universities.filter(u => continentOf(u.country) === wizardState.filters.continent).map(u => u.country)
    : universities.map(u => u.country);
  uniqueSorted(countries).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    countrySelect.appendChild(opt);
  });
  if ([...countrySelect.options].some(o => o.value === current)) countrySelect.value = current;
  else wizardState.filters.country = "";
}

function populateFilterControls() {
  const continentSelect = document.getElementById("filter-continent");
  uniqueSorted(universities.map(u => continentOf(u.country))).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    continentSelect.appendChild(opt);
  });
  continentSelect.addEventListener("change", () => {
    wizardState.filters.continent = continentSelect.value;
    populateCountrySelect();
  });

  populateCountrySelect();
  document.getElementById("filter-country").addEventListener("change", e => {
    wizardState.filters.country = e.target.value;
  });

  document.getElementById("filter-rank").addEventListener("change", e => {
    wizardState.filters.rankMax = e.target.value;
  });

  document.getElementById("filter-tuition").addEventListener("input", e => {
    wizardState.filters.tuition = e.target.value;
  });
}

// ---------- Wizard navigation ----------

function goToStep(step) {
  wizardState.step = step;
  document.querySelectorAll(".wizard-panel").forEach(p => p.classList.remove("active"));
  document.getElementById(`wizard-step-${step}`).classList.add("active");
  document.querySelectorAll(".wizard-step-dot").forEach(d => {
    d.classList.toggle("active", Number(d.dataset.step) === step);
    d.classList.toggle("done", Number(d.dataset.step) < step);
  });
  document.getElementById("wizard-back").hidden = step === 1;
  document.getElementById("wizard-next").textContent = step === 4 ? "Show my matches" : "Next";
}

function setupWizardNav() {
  document.getElementById("wizard-next").addEventListener("click", () => {
    if (wizardState.step < 4) {
      goToStep(wizardState.step + 1);
    } else {
      showResults();
    }
  });
  document.getElementById("wizard-back").addEventListener("click", () => {
    if (wizardState.step > 1) goToStep(wizardState.step - 1);
  });
  document.getElementById("wizard-skip").addEventListener("click", () => {
    showResults();
  });
}

// ---------- Matching engine ----------

function computeMatches() {
  const { filters, interests } = wizardState;
  const totalIB = totalIBPoints();
  const hasProfile = hasIBProfile();

  let results = programEntries.filter(entry => {
    const u = entry.university;
    if (interests.size && !interests.has(entry.field)) return false;
    if (filters.continent && continentOf(u.country) !== filters.continent) return false;
    if (filters.country && u.country !== filters.country) return false;
    if (filters.rankMax && u.rank > Number(filters.rankMax)) return false;
    if (filters.tuition && u.tuitionUSD != null && u.tuitionUSD > Number(filters.tuition)) return false;
    return true;
  });

  return results.map(entry => {
    const ib = effectiveIBRange(entry.university);
    let fitScore = null;
    let fitLabel = "Enter your IB profile to see a fit score";
    if (hasProfile) {
      if (!ib) {
        fitScore = 60;
        fitLabel = "Not enough admissions data published to estimate fit";
      } else if (totalIB >= ib.min) {
        fitScore = 100;
        const rangeText = ib.max && ib.max !== ib.min ? `${ib.min}–${ib.max}` : `${ib.min}`;
        fitLabel = `Meets the ${ib.estimated ? "estimated" : "published"} requirement (${rangeText} pts)`;
      } else {
        const gap = ib.min - totalIB;
        fitScore = Math.max(0, 100 - gap * 12);
        fitLabel = `${gap} point${gap === 1 ? "" : "s"} below the ${ib.estimated ? "estimated" : "published"} requirement (${ib.min} pts)`;
      }
    }
    return { ...entry, ib, fitScore, fitLabel, totalIB, hasProfile };
  });
}

function sortResults(results, sortBy) {
  const arr = [...results];
  if (sortBy === "rank") {
    arr.sort((a, b) => a.university.rank - b.university.rank);
  } else if (sortBy === "name") {
    arr.sort((a, b) => a.programName.localeCompare(b.programName));
  } else {
    arr.sort((a, b) => {
      const fa = a.fitScore == null ? 50 : a.fitScore;
      const fb = b.fitScore == null ? 50 : b.fitScore;
      if (fb !== fa) return fb - fa;
      return a.university.rank - b.university.rank;
    });
  }
  return arr;
}

// ---------- Results view ----------

function showResults() {
  currentMatches = computeMatches();
  document.getElementById("wizard-view").hidden = true;
  document.getElementById("results-view").hidden = false;
  renderResultsSummary();
  renderResults();
}

function renderResultsSummary() {
  const totalIB = totalIBPoints();
  const hasProfile = hasIBProfile();
  document.getElementById("results-summary").textContent = wizardState.interests.size
    ? `Showing ${[...wizardState.interests].join(", ")} programs`
    : "Showing all social science programs";
  document.getElementById("results-total-points").textContent = hasProfile
    ? `Your IB total: ${totalIB} / 45`
    : "No IB profile entered — results are unranked by fit";
}

function programCardHtml(entry) {
  const badge = entry.fitScore == null ? "" : `<span class="badge match-badge">${Math.round(entry.fitScore)}% fit</span>`;
  return `
    <div class="card clickable" data-slug="${entry.slug}" role="button" tabindex="0" aria-haspopup="dialog">
      <div class="card-top">
        <h3>${entry.programName}</h3>
        ${badge}
      </div>
      <span class="meta">${entry.university.name} · #${entry.university.rank} · ${entry.university.country}</span>
      <p>${entry.field}</p>
    </div>
  `;
}

function renderResults() {
  const query = document.getElementById("results-search").value.trim().toLowerCase();
  const sortBy = document.getElementById("results-sort").value;

  let results = currentMatches.filter(e =>
    e.programName.toLowerCase().includes(query) || e.university.name.toLowerCase().includes(query)
  );
  results = sortResults(results, sortBy);

  document.getElementById("results-count").textContent = `${results.length} program${results.length === 1 ? "" : "s"} found`;

  const list = document.getElementById("results-list");
  list.innerHTML = results.length
    ? results.map(programCardHtml).join("")
    : `<p class="no-results">No programs match your filters. Try widening them, or edit your preferences.</p>`;
}

function setupResultsListeners() {
  document.getElementById("results-search").addEventListener("input", renderResults);
  document.getElementById("results-sort").addEventListener("change", renderResults);
  document.getElementById("edit-preferences").addEventListener("click", () => {
    document.getElementById("results-view").hidden = true;
    document.getElementById("wizard-view").hidden = false;
    goToStep(1);
  });
}

// ---------- Program detail modal ----------

function programModalHtml(entry) {
  const u = entry.university;
  const ib = entry.ib || effectiveIBRange(u);

  const fitHtml = entry.hasProfile && entry.fitScore != null
    ? `<div class="modal-fit"><span class="fit-score">${Math.round(entry.fitScore)}% fit</span><span class="fit-label">${entry.fitLabel}</span></div>`
    : "";

  const reqHtml = ib
    ? `<p class="modal-admission-line">${ib.official ? "Published requirement" : "Estimated equivalent — not officially published"}: <strong>${ib.min}${ib.max && ib.max !== ib.min ? `–${ib.max}` : ""} / 45 points</strong>${ib.source ? ` — <a href="${ib.source}" target="_blank" rel="noopener">source</a>` : ""}</p>`
    : `<p class="modal-admission-line">Insufficient published data to estimate a required IB score for this university.</p>`;

  const compHtml = entry.competitiveness
    ? `<p class="modal-admission-line">Program-specific competitiveness: ${entry.competitiveness}${entry.sourceUrl ? ` — <a href="${entry.sourceUrl}" target="_blank" rel="noopener">source</a>` : ""}</p>`
    : "";

  const tuitionHtml = u.tuitionDisplay
    ? `<p class="modal-admission-line">Tuition (international, annual): ${u.tuitionDisplay}${u.tuitionSource ? ` — <a href="${u.tuitionSource}" target="_blank" rel="noopener">source</a>` : ""}</p>`
    : "";

  return `
    <div class="modal-eyebrow">
      <span class="badge">${entry.field}</span>
      <span class="modal-country">${u.country}</span>
    </div>
    <h2 id="modal-title">${entry.programName}</h2>
    <p class="modal-university-line">${u.name} · QS rank #${u.rank}</p>
    ${fitHtml}
    <p class="modal-description">${u.description}</p>
    <a class="modal-site-link" href="${u.site}" target="_blank" rel="noopener">Visit official site →</a>
    <p class="modal-section-title">Admission</p>
    ${reqHtml}
    ${compHtml}
    ${tuitionHtml}
  `;
}

function openProgramModal(slug, pushHistory = true) {
  let entry = currentMatches.find(e => e.slug === slug) || programEntryBySlug.get(slug);
  if (!entry) return;
  if (!("ib" in entry)) {
    entry = { ...entry, ib: effectiveIBRange(entry.university), fitScore: null, fitLabel: null, hasProfile: false };
  }
  document.getElementById("modal-body").innerHTML = programModalHtml(entry);
  document.getElementById("modal-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById("modal-close").focus();
  if (pushHistory) history.pushState({ programSlug: slug }, "", `#program/${slug}`);
}

function closeProgramModal(popHistory = true) {
  const backdrop = document.getElementById("modal-backdrop");
  if (backdrop.hidden) return;
  backdrop.hidden = true;
  document.body.style.overflow = "";
  if (popHistory && location.hash.startsWith("#program/")) history.back();
}

function setupModal() {
  document.getElementById("results-list").addEventListener("click", e => {
    if (e.target.closest("a")) return;
    const card = e.target.closest(".card.clickable");
    if (card) openProgramModal(card.dataset.slug);
  });
  document.getElementById("results-list").addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".card.clickable");
    if (!card) return;
    e.preventDefault();
    openProgramModal(card.dataset.slug);
  });

  document.getElementById("modal-close").addEventListener("click", () => closeProgramModal());
  document.getElementById("modal-backdrop").addEventListener("click", e => {
    if (e.target.id === "modal-backdrop") closeProgramModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeProgramModal();
  });

  window.addEventListener("popstate", () => {
    const match = location.hash.match(/^#program\/(.+)$/);
    if (match && programEntryBySlug.has(match[1])) {
      if (document.getElementById("results-view").hidden) showResults();
      openProgramModal(match[1], false);
    } else {
      closeProgramModal(false);
    }
  });
}

// ---------- Init ----------

document.addEventListener("DOMContentLoaded", () => {
  renderSubjectGrid();
  renderInterestGrid();
  populateFilterControls();
  document.getElementById("core-points").addEventListener("change", e => {
    wizardState.corePoints = Number(e.target.value);
    updateWizardTotal();
  });
  setupWizardNav();
  setupResultsListeners();
  setupModal();
  goToStep(1);

  const initialMatch = location.hash.match(/^#program\/(.+)$/);
  if (initialMatch && programEntryBySlug.has(initialMatch[1])) {
    showResults();
    openProgramModal(initialMatch[1], false);
  }
});
