/**
 * CLINICAL TAXONOMY - Sistema Unificado de Termos Guarda-Chuva
 * 
 * FILOSOFIA:
 * - Cada diagnostico especifico eh agrupado sob um TERMO GUARDA-CHUVA mais abrangente
 * - O termo guarda-chuva eh a CONDICAO CLINICA, nunca apenas a regiao anatomica
 * - Regioes anatomicas puras (Coluna Lombar, Joelho, Ombro) sao EXCLUIDAS
 *   quando ja existe um diagnostico clinico associado
 * - Regioes anatomicas que sao INTRINSECAS ao diagnostico sao mantidas
 *   (ex: "Lombalgia", "Dor Sacroilíaca" - a regiao eh parte do nome do quadro)
 * 
 * MULTIPROFISSIONAL: Cobre Fisioterapia, Psicologia, Nutrição, Medicina,
 * Odontologia, Fonoaudiologia, Veterinária, Ed. Física, etc.
 */

// ============================================================
// TERMOS GUARDA-CHUVA (UMBRELLA TERMS)
// Mapeamento: termo especifico (lowercase) -> termo guarda-chuva
// ============================================================

export const UMBRELLA_TERMS: Record<string, string> = {
  // ====== FISIOTERAPIA / REABILITAÇÃO ======

  // --- TENDINOPATIAS (guarda-chuva: Tendinopatia) ---
  'tendinopatia': 'Tendinopatia',
  'tendinite': 'Tendinopatia',
  'tendinose': 'Tendinopatia',
  'tendinopatia aquiles': 'Tendinopatia',
  'tendinite aquiles': 'Tendinopatia',
  'tendinopatia insercional': 'Tendinopatia',
  'tendinite insercional': 'Tendinopatia',
  'tendao de aquiles': 'Tendinopatia',
  'tendinopatia patelar': 'Tendinopatia',
  'tendinite patelar': 'Tendinopatia',
  'tendinopatia do supraespinhal': 'Tendinopatia',
  'tendinopatia do supraespinhoso': 'Tendinopatia',
  'tendinopatia reativa': 'Tendinopatia',
  'tendinite supraespinhal': 'Tendinopatia',
  'tendinite ombro': 'Tendinopatia',
  'tendinite bicipital': 'Tendinopatia',
  'tendinite punho': 'Tendinopatia',
  'tendinite de quervain': 'Tendinopatia',
  'epicondilite': 'Tendinopatia',
  'epicondilite lateral': 'Tendinopatia',
  'epicondilite medial': 'Tendinopatia',
  'cotovelo de tenista': 'Tendinopatia',
  'cotovelo de golfista': 'Tendinopatia',
  'tenossinovite': 'Tendinopatia',
  'dedo em gatilho': 'Tendinopatia',

  // --- ARTROPATIAS / ARTROSE (guarda-chuva: Artropatia) ---
  'artrose': 'Artropatia',
  'artrite': 'Artropatia',
  'osteoartrose': 'Artropatia',
  'osteoartrite': 'Artropatia',
  'gonartrose': 'Artropatia',
  'coxartrose': 'Artropatia',
  'artrose joelho': 'Artropatia',
  'artrose quadril': 'Artropatia',
  'artrose ombro': 'Artropatia',
  'artrose cervical': 'Artropatia',
  'espondiloartrose': 'Artropatia',
  'artrite reumatoide': 'Artropatia',
  'artrite gotosa': 'Artropatia',
  'condromalacia': 'Artropatia',
  'condromalacia patelar': 'Artropatia',
  'condropatia patelar': 'Artropatia',

  // --- LOMBALGIA e derivados (guarda-chuva: Lombalgia) ---
  'lombalgia': 'Lombalgia',
  'dor lombar': 'Lombalgia',
  'dor nas costas': 'Lombalgia',
  'lombalgia mecanica': 'Lombalgia',
  'lombalgia aguda': 'Lombalgia',
  'lombalgia cronica': 'Lombalgia',
  'lombociatalgia': 'Lombalgia',
  'lumbago': 'Lombalgia',

  // --- CERVICALGIA (guarda-chuva: Cervicalgia) ---
  'cervicalgia': 'Cervicalgia',
  'dor cervical': 'Cervicalgia',
  'cervicobr aquialgia': 'Cervicalgia',
  'cervicobraquialgia': 'Cervicalgia',
  'torcicolo': 'Cervicalgia',

  // --- DORSALGIA (guarda-chuva: Dorsalgia) ---
  'dorsalgia': 'Dorsalgia',
  'dor toracica': 'Dorsalgia',
  'dor dorsal': 'Dorsalgia',

  // --- DISCOPATIA (guarda-chuva: Discopatia) ---
  'hernia de disco': 'Discopatia',
  'hernia discal': 'Discopatia',
  'protrusao discal': 'Discopatia',
  'abaulamento discal': 'Discopatia',
  'discopatia': 'Discopatia',
  'discopatia degenerativa': 'Discopatia',
  'radiculopatia': 'Discopatia',
  'compressao radicular': 'Discopatia',

  // --- ESPONDILOPATIA (guarda-chuva: Espondilopatia) ---
  'espondilose': 'Espondilopatia',
  'espondilite': 'Espondilopatia',
  'espondilolistese': 'Espondilopatia',
  'espondilolise': 'Espondilopatia',
  'estenose espinhal': 'Espondilopatia',
  'estenose lombar': 'Espondilopatia',

  // --- DOR SACROILÍACA (guarda-chuva: Dor Sacroiliaca) ---
  'dor sacroiliaca': 'Dor Sacroiliaca',
  'sacroileite': 'Dor Sacroiliaca',
  'disfuncao sacroiliaca': 'Dor Sacroiliaca',

  // --- ESCOLIOSE (guarda-chuva: Escoliose) ---
  'escoliose': 'Escoliose',
  'escoliose idiopatica': 'Escoliose',
  'escoliose degenerativa': 'Escoliose',
  'hipercifose': 'Escoliose',
  'hiperlordose': 'Escoliose',

  // --- LESÃO LIGAMENTAR (guarda-chuva: Lesao Ligamentar) ---
  'lesao lca': 'Lesao Ligamentar',
  'ruptura lca': 'Lesao Ligamentar',
  'lesao lcp': 'Lesao Ligamentar',
  'lesao ligamentar': 'Lesao Ligamentar',
  'entorse': 'Lesao Ligamentar',
  'entorse tornozelo': 'Lesao Ligamentar',
  'entorse joelho': 'Lesao Ligamentar',
  'instabilidade articular': 'Lesao Ligamentar',
  'instabilidade tornozelo': 'Lesao Ligamentar',

  // --- LESÃO MENISCAL (guarda-chuva: Lesao Meniscal) ---
  'lesao menisco': 'Lesao Meniscal',
  'lesao meniscal': 'Lesao Meniscal',
  'ruptura menisco': 'Lesao Meniscal',
  'meniscopatia': 'Lesao Meniscal',

  // --- BURSITE (guarda-chuva: Bursite) ---
  'bursite': 'Bursite',
  'bursite ombro': 'Bursite',
  'bursite trocanterica': 'Bursite',
  'bursite quadril': 'Bursite',
  'bursite joelho': 'Bursite',
  'bursite olecrano': 'Bursite',

  // --- CAPSULITE (guarda-chuva: Capsulite Adesiva) ---
  'capsulite adesiva': 'Capsulite Adesiva',
  'ombro congelado': 'Capsulite Adesiva',
  'capsulite': 'Capsulite Adesiva',

  // --- LESÃO MANGUITO ROTADOR (guarda-chuva: Lesao Manguito Rotador) ---
  'lesao manguito rotador': 'Lesao Manguito Rotador',
  'sindrome do manguito': 'Lesao Manguito Rotador',
  'manguito rotador': 'Lesao Manguito Rotador',
  'ruptura manguito': 'Lesao Manguito Rotador',
  'sindrome impacto': 'Lesao Manguito Rotador',
  'sindrome do impacto': 'Lesao Manguito Rotador',

  // --- SÍNDROME PATELOFEMORAL (guarda-chuva: Sindrome Patelofemoral) ---
  'sindrome patelofemoral': 'Sindrome Patelofemoral',
  'dor anterior joelho': 'Sindrome Patelofemoral',
  'dor patelofemoral': 'Sindrome Patelofemoral',

  // --- FASCIOPATIA (guarda-chuva: Fasciopatia Plantar) ---
  'fascite plantar': 'Fasciopatia Plantar',
  'fasciite plantar': 'Fasciopatia Plantar',
  'fasciopatia plantar': 'Fasciopatia Plantar',
  'esporao calcaneo': 'Fasciopatia Plantar',
  'dor plantar': 'Fasciopatia Plantar',

  // --- SÍNDROME MIOFASCIAL (guarda-chuva: Sindrome Miofascial) ---
  'dor miofascial': 'Sindrome Miofascial',
  'sindrome miofascial': 'Sindrome Miofascial',
  'ponto gatilho': 'Sindrome Miofascial',
  'dor tensional': 'Sindrome Miofascial',
  'tensao muscular': 'Sindrome Miofascial',
  'contratura': 'Sindrome Miofascial',
  'contratura muscular': 'Sindrome Miofascial',
  'espasmo muscular': 'Sindrome Miofascial',

  // --- NEUROPATIA (guarda-chuva: Neuropatia) ---
  'neuropatia': 'Neuropatia',
  'neuropatia periferica': 'Neuropatia',
  'neuralgia': 'Neuropatia',
  'sindrome tunel carpo': 'Neuropatia',
  'tunel do carpo': 'Neuropatia',
  'sindrome piriforme': 'Neuropatia',

  // --- FRATURAS (guarda-chuva: Fratura) ---
  'fratura': 'Fratura',
  'fratura coluna': 'Fratura',
  'fratura femur': 'Fratura',
  'fratura radio': 'Fratura',
  'fratura tornozelo': 'Fratura',
  'fratura estresse': 'Fratura',

  // --- PÓS-OPERATÓRIO (guarda-chuva: Pos-Operatorio) ---
  'pos operatorio': 'Pos-Operatorio',
  'pos-operatorio': 'Pos-Operatorio',
  'po joelho': 'Pos-Operatorio',
  'po ombro': 'Pos-Operatorio',
  'po coluna': 'Pos-Operatorio',
  'artroscopia': 'Pos-Operatorio',
  'artroplastia': 'Pos-Operatorio',
  'reconstrucao lca': 'Pos-Operatorio',

  // --- FIBROMIALGIA ---
  'fibromialgia': 'Fibromialgia',
  'dor cronica generalizada': 'Fibromialgia',
  'dor difusa': 'Fibromialgia',

  // --- SÍNDROME DOLOROSA (inespecífica) ---
  'sindrome dolorosa': 'Sindrome Dolorosa',
  'dor inespecifica': 'Sindrome Dolorosa',

  // --- LESÃO MUSCULAR ---
  'lesao muscular': 'Lesao Muscular',
  'distensao muscular': 'Lesao Muscular',
  'estiramento muscular': 'Lesao Muscular',
  'ruptura muscular': 'Lesao Muscular',

  // ====== NEUROLOGIA ======

  // --- AVC ---
  'avc': 'AVC',
  'acidente vascular cerebral': 'AVC',
  'acidente vascular encefalico': 'AVC',
  'hemiplegia': 'AVC',
  'hemiparesia': 'AVC',

  // --- PARKINSON ---
  'parkinson': 'Parkinson',
  'doenca de parkinson': 'Parkinson',

  // --- PARALISIA CEREBRAL ---
  'paralisia cerebral': 'Paralisia Cerebral',

  // --- ESCLEROSE MÚLTIPLA ---
  'esclerose multipla': 'Esclerose Multipla',
  'esclerose múltipla': 'Esclerose Multipla',

  // ====== PSICOLOGIA / PSIQUIATRIA ======

  // --- DEPRESSÃO ---
  'depressao': 'Depressao',
  'transtorno depressivo': 'Depressao',
  'depressao maior': 'Depressao',
  'episodio depressivo': 'Depressao',
  'distimia': 'Depressao',

  // --- ANSIEDADE ---
  'ansiedade': 'Ansiedade',
  'transtorno ansiedade': 'Ansiedade',
  'ansiedade generalizada': 'Ansiedade',
  'transtorno de ansiedade generalizada': 'Ansiedade',
  'fobia social': 'Ansiedade',
  'fobia': 'Ansiedade',
  'agorafobia': 'Ansiedade',

  // --- TRANSTORNO DO PÂNICO ---
  'panico': 'Transtorno do Panico',
  'transtorno panico': 'Transtorno do Panico',
  'sindrome do panico': 'Transtorno do Panico',
  'ataque de panico': 'Transtorno do Panico',

  // --- TDAH ---
  'tdah': 'TDAH',
  'deficit de atencao': 'TDAH',
  'hiperatividade': 'TDAH',

  // --- TOC ---
  'toc': 'TOC',
  'transtorno obsessivo': 'TOC',
  'compulsao': 'TOC',

  // --- BURNOUT ---
  'burnout': 'Burnout',
  'esgotamento profissional': 'Burnout',
  'sindrome de burnout': 'Burnout',

  // --- TEPT ---
  'tept': 'TEPT',
  'estresse pos traumatico': 'TEPT',
  'estresse pos-traumatico': 'TEPT',
  'transtorno de estresse pos traumatico': 'TEPT',

  // --- LUTO ---
  'luto': 'Luto',
  'luto complicado': 'Luto',
  'luto patologico': 'Luto',

  // --- TRANSTORNOS ALIMENTARES ---
  'anorexia': 'Transtorno Alimentar',
  'bulimia': 'Transtorno Alimentar',
  'compulsao alimentar': 'Transtorno Alimentar',
  'transtorno alimentar': 'Transtorno Alimentar',

  // --- AUTISMO ---
  'autismo': 'TEA',
  'tea': 'TEA',
  'espectro autista': 'TEA',

  // --- DEPENDÊNCIA QUÍMICA ---
  'dependencia quimica': 'Dependencia Quimica',
  'alcoolismo': 'Dependencia Quimica',
  'tabagismo': 'Dependencia Quimica',
  'drogadicao': 'Dependencia Quimica',

  // --- TRANSTORNO BIPOLAR / PSICOSE ---
  'transtorno bipolar': 'Transtorno Bipolar',
  'bipolar': 'Transtorno Bipolar',
  'esquizofrenia': 'Esquizofrenia',
  'surto psicotico': 'Esquizofrenia',

  // ====== NUTRIÇÃO / MEDICINA ======

  // --- OBESIDADE ---
  'obesidade': 'Obesidade',
  'sobrepeso': 'Obesidade',
  'obesidade morbida': 'Obesidade',

  // --- DIABETES ---
  'diabetes': 'Diabetes',
  'diabetes mellitus': 'Diabetes',
  'diabetes tipo 1': 'Diabetes',
  'diabetes tipo 2': 'Diabetes',
  'pre-diabetes': 'Diabetes',
  'resistencia insulina': 'Diabetes',
  'dm2': 'Diabetes',
  'dm1': 'Diabetes',

  // --- HIPERTENSÃO ---
  'hipertensao': 'Hipertensao',
  'hipertensao arterial': 'Hipertensao',
  'has': 'Hipertensao',
  'pressao alta': 'Hipertensao',

  // --- DISLIPIDEMIA ---
  'dislipidemia': 'Dislipidemia',
  'colesterol alto': 'Dislipidemia',
  'hipercolesterolemia': 'Dislipidemia',
  'hipertrigliceridemia': 'Dislipidemia',

  // --- DOENÇA RENAL ---
  'doenca renal': 'Doenca Renal',
  'insuficiencia renal': 'Doenca Renal',
  'nefropatia': 'Doenca Renal',

  // --- DOENÇA HEPÁTICA ---
  'esteatose': 'Doenca Hepatica',
  'esteatose hepatica': 'Doenca Hepatica',
  'doenca hepatica': 'Doenca Hepatica',
  'hepatopatia': 'Doenca Hepatica',

  // --- HIPOTIREOIDISMO ---
  'hipotireoidismo': 'Tireopatia',
  'hipertireoidismo': 'Tireopatia',
  'tireopatia': 'Tireopatia',
  'doenca tireoide': 'Tireopatia',

  // --- ANEMIA ---
  'anemia': 'Anemia',
  'anemia ferropriva': 'Anemia',
  'deficiencia ferro': 'Anemia',

  // --- CARDIOLOGIA / PULMONAR (medicina humana) ---
  'insuficiencia cardiaca': 'Cardiopatia',
  'icc': 'Cardiopatia',
  'angina': 'Cardiopatia',
  'infarto': 'Cardiopatia',
  'iam': 'Cardiopatia',
  'arritmia': 'Cardiopatia',
  'asma': 'Asma',
  'crise asmatica': 'Asma',
  'dpoc': 'DPOC',
  'bronquite cronica': 'DPOC',
  'enfisema': 'DPOC',
  'pneumonia': 'Infeccao',
  'infeccao urinaria': 'Infeccao',
  'itu': 'Infeccao',
  'infeccao respiratoria': 'Infeccao',
  'cefaleia': 'Cefaleia',
  'enxaqueca': 'Cefaleia',
  'migranea': 'Cefaleia',
  'gestacao': 'Gestacao',
  'gravidez': 'Gestacao',
  'pre-natal': 'Gestacao',

  // ====== ENFERMAGEM ======
  'lesao por pressao': 'Lesao por Pressao',
  'ulcera por pressao': 'Lesao por Pressao',
  'escara': 'Lesao por Pressao',
  'ferida operatoria': 'Ferida Operatoria',
  'deiscencia': 'Ferida Operatoria',
  'sepse': 'Sepse',
  'choque septico': 'Sepse',
  'desidratacao': 'Desidratacao',
  'dor cronica': 'Dor Cronica',
  'cuidados paliativos': 'Cuidados Paliativos',
  'cuidado paliativo': 'Cuidados Paliativos',

  // ====== ODONTOLOGIA ======

  // --- CÁRIE ---
  'carie': 'Carie',
  'carie dentaria': 'Carie',
  'lesao cariosa': 'Carie',

  // --- DOENÇA PERIODONTAL ---
  'periodontite': 'Doenca Periodontal',
  'gengivite': 'Doenca Periodontal',
  'doenca periodontal': 'Doenca Periodontal',
  'retracao gengival': 'Doenca Periodontal',

  // --- DTM ---
  'dtm': 'DTM',
  'disfuncao atm': 'DTM',
  'disfuncao temporomandibular': 'DTM',
  'bruxismo': 'DTM',
  'dor orofacial': 'DTM',

  // --- ENDODONTIA ---
  'pulpite': 'Endodontia',
  'necrose pulpar': 'Endodontia',
  'abscesso dentario': 'Endodontia',
  'abscesso periapical': 'Endodontia',

  // --- MALOCLUSÃO ---
  'maloclusao': 'Maloclusao',
  'mordida cruzada': 'Maloclusao',
  'mordida aberta': 'Maloclusao',

  // --- TRAUMA DENTÁRIO ---
  'traumatismo dentario': 'Traumatismo Dentario',
  'avulsao dentaria': 'Traumatismo Dentario',
  'fratura dentaria': 'Traumatismo Dentario',

  // ====== FONOAUDIOLOGIA ======

  // --- DISFONIA ---
  'disfonia': 'Disfonia',
  'rouquidao': 'Disfonia',
  'nodulo vocal': 'Disfonia',
  'polipo vocal': 'Disfonia',
  'paralisia cordas vocais': 'Disfonia',

  // --- DISFAGIA ---
  'disfagia': 'Disfagia',
  'dificuldade deglutir': 'Disfagia',
  'engasgo': 'Disfagia',

  // --- DISTÚRBIO DE LINGUAGEM ---
  'afasia': 'Disturbio de Linguagem',
  'atraso linguagem': 'Disturbio de Linguagem',
  'disturbio linguagem': 'Disturbio de Linguagem',
  'dislexia': 'Disturbio de Linguagem',

  // --- DISTÚRBIO DE FALA ---
  'dislalia': 'Disturbio de Fala',
  'gagueira': 'Disturbio de Fala',
  'apraxia fala': 'Disturbio de Fala',
  'disturbio fala': 'Disturbio de Fala',

  // --- DISTÚRBIO AUDITIVO ---
  'perda auditiva': 'Disturbio Auditivo',
  'surdez': 'Disturbio Auditivo',
  'zumbido': 'Disturbio Auditivo',
  'tinnitus': 'Disturbio Auditivo',

  // ====== VETERINÁRIA ======

  // --- DERMATOPATIA ---
  'dermatite': 'Dermatopatia',
  'atopia': 'Dermatopatia',
  'dermatite atopica': 'Dermatopatia',
  'pioderma': 'Dermatopatia',
  'alergia cutanea': 'Dermatopatia',

  // --- OTITE ---
  'otite': 'Otite',
  'otite externa': 'Otite',
  'otite media': 'Otite',

  // --- GASTROENTEROPATIA ---
  'gastrite': 'Gastroenteropatia',
  'enterite': 'Gastroenteropatia',
  'gastroenterite': 'Gastroenteropatia',
  'colite': 'Gastroenteropatia',
  'pancreatite': 'Gastroenteropatia',
  'ibd': 'Gastroenteropatia',

  // --- DOENÇA RENAL (VET) ---
  'drc': 'Doenca Renal Cronica',
  'insuficiencia renal felina': 'Doenca Renal Cronica',

  // --- CARDIOPATIA ---
  'cardiopatia': 'Cardiopatia',
  'sopro cardiaco': 'Cardiopatia',
  'cardiomiopatia': 'Cardiopatia',

  // --- ENDOCRINOPATIA (VET) ---
  'diabetes canino': 'Endocrinopatia',
  'diabetes felino': 'Endocrinopatia',
  'hipotireoidismo canino': 'Endocrinopatia',
  'hipertireoidismo felino': 'Endocrinopatia',
  'hiperadrenocorticismo': 'Endocrinopatia',
  'cushing': 'Endocrinopatia',

  // --- DISPLASIA ---
  'displasia coxofemoral': 'Displasia',
  'displasia': 'Displasia',
  'displasia cotovelo': 'Displasia',
};

// ============================================================
// REGIÕES ANATÔMICAS PURAS (devem ser suprimidas quando existe diagnóstico)
// Se a tag for APENAS uma região anatômica e já há um diagnóstico,
// ela é redundante e deve ser removida
// ============================================================

export const PURE_ANATOMICAL_REGIONS = new Set([
  // Coluna
  'coluna', 'coluna lombar', 'coluna cervical', 'coluna toracica', 'coluna dorsal',
  'regiao lombar', 'regiao cervical', 'regiao dorsal', 'regiao sacral',
  // Membros superiores
  'ombro', 'cotovelo', 'punho', 'mao', 'dedos',
  'ombro direito', 'ombro esquerdo',
  'membro superior', 'mmss',
  // Membros inferiores
  'joelho', 'tornozelo', 'pe', 'quadril', 'coxa', 'perna', 'panturrilha',
  'joelho direito', 'joelho esquerdo',
  'membro inferior', 'mmii',
  // Tronco
  'torax', 'abdomen', 'pelve', 'sacro', 'coccix',
  // Cabeça/Pescoço
  'cabeca', 'pescoco', 'face', 'mandibula', 'cranio',
  // Genéricos
  'membro', 'articulacao', 'musculatura', 'tendao',
  'lado direito', 'lado esquerdo',
  'bilateral', 'unilateral',
]);

// ============================================================
// TERMOS DE TRATAMENTO/CONDUTA (sempre excluídos)
// ============================================================

export const EXCLUDED_TERMS = new Set([
  // Fisioterapia
  'cinesioterapia', 'fortalecimento', 'fortalecimento muscular',
  'exercicios', 'exercicios isometricos', 'exercicios terapeuticos',
  'terapia manual', 'liberacao miofascial',
  'mobilizacao', 'mobilizacao articular', 'mobilizacao neural',
  'alongamento', 'flexibilidade',
  'eletroterapia', 'tens', 'ultrassom', 'laser', 'ondas de choque',
  'crioterapia', 'termoterapia',
  'massagem', 'massoterapia', 'drenagem linfatica',
  'avaliacao', 'reavaliacao', 'alta',
  'orientacoes', 'educacao', 'educacao em saude',
  'bandagem', 'kinesiotaping', 'taping',
  'pilates', 'hidroterapia', 'mecanoterapia',
  'treino funcional', 'propriocepcao',
  // Psicologia
  'tcc', 'psicanalise', 'humanista', 'sistemica', 'gestalt',
  'cognitivo comportamental',
  // Nutrição
  'dieta', 'reeducacao alimentar', 'suplementacao',
  'dieta low carb', 'dieta cetogenica',
  // Medicina
  'prescricao', 'medicacao', 'medicamento',
  // Genéricos
  'tratamento', 'sessao', 'acompanhamento', 'controle',
  'investigacao', 'encaminhamento', 'retorno',
  // Categorias genéricas demais
  'musculoesqueletico', 'neurologico', 'esportivo',
  'ortopedico', 'reumatologico', 'respiratorio',
]);

// ============================================================
// FUNÇÕES DE NORMALIZAÇÃO
// ============================================================

/**
 * Remove acentos de uma string para comparação
 */
function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Limpa uma tag: remove CID-10, acentos, trim
 */
function cleanTag(tag: string): string {
  let cleaned = tag;
  // Remover códigos CID-10 entre parênteses: (M54.5), (F32.1)
  cleaned = cleaned.replace(/\s*\([A-Z]\d{2}(\.\d{1,2})?\)/g, '');
  // Remover códigos CID-10 soltos no final: M54.5
  cleaned = cleaned.replace(/\s+[A-Z]\d{2}(\.\d{1,2})?\s*$/g, '');
  return cleaned.trim();
}

/**
 * Verifica se um termo é tratamento/conduta (deve ser excluído)
 */
export function isExcludedTerm(tag: string): boolean {
  const lower = removeAccents(tag.toLowerCase().trim());

  // Verificar lista direta
  if (EXCLUDED_TERMS.has(lower)) return true;

  // Verificar keywords parciais de tratamento
  const treatmentKeywords = [
    'exercicio', 'terapia', 'tratamento', 'sessao', 'orientac',
    'alongamento', 'fortalec', 'mobiliza', 'prescri',
  ];
  for (const kw of treatmentKeywords) {
    if (lower.includes(kw)) return true;
  }

  return false;
}

/**
 * Verifica se o termo é uma região anatômica pura
 */
export function isPureAnatomicalRegion(tag: string): boolean {
  const lower = removeAccents(tag.toLowerCase().trim());
  return PURE_ANATOMICAL_REGIONS.has(lower);
}

/**
 * Busca o termo guarda-chuva para um diagnóstico.
 * - Match exato da string completa
 * - Match exato de token/palavra (siglas: DM2, HAS, AVC, TDAH…)
 * - Match parcial (substring) só para chaves com >= 5 caracteres
 */
export function findUmbrellaTerm(tag: string): string | null {
  const lower = removeAccents(tag.toLowerCase().trim());

  if (UMBRELLA_TERMS[lower]) {
    return UMBRELLA_TERMS[lower];
  }

  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (UMBRELLA_TERMS[token]) {
      return UMBRELLA_TERMS[token];
    }
  }

  const sortedKeys = Object.keys(UMBRELLA_TERMS)
    .filter((k) => k.length >= 5)
    .sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key)) {
      return UMBRELLA_TERMS[key];
    }
  }

  return null;
}

/**
 * Normaliza uma tag para o Perfil Clínico.
 * Retorna:
 * - O termo guarda-chuva se encontrou match
 * - O termo capitalizado se é diagnóstico desconhecido mas válido
 * - null se deve ser excluído (tratamento, região anatômica pura, incompleto)
 */
export function normalizeToUmbrella(rawTag: string): string | null {
  // 1. Limpar (remover CID-10, trim)
  const cleaned = cleanTag(rawTag);
  if (!cleaned || cleaned.length < 3) return null;

  const lower = removeAccents(cleaned.toLowerCase());

  // 2. Excluir tratamentos/condutas
  if (isExcludedTerm(cleaned)) return null;

  // 3. Excluir regiões anatômicas puras
  if (isPureAnatomicalRegion(cleaned)) return null;

  // 4. Excluir tags incompletas/genéricas
  if (lower === 'tendao de' || lower === 'tendao' || lower === 'tendão de' || lower === 'tendão') {
    return null;
  }

  // 5. Buscar termo guarda-chuva
  const umbrella = findUmbrellaTerm(cleaned);
  if (umbrella) return umbrella;

  // 6. Diagnóstico desconhecido: capitalizar e retornar (limitar tamanho)
  let result = cleaned;
  if (result.length > 30) {
    const words = result.split(/[\s,]+/).filter(w => w.length > 0);
    let truncated = '';
    for (const word of words) {
      if ((truncated + ' ' + word).trim().length <= 30) {
        truncated = (truncated + ' ' + word).trim();
      } else break;
    }
    result = truncated || words[0];
  }

  // Capitalizar
  result = result
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return result;
}

/**
 * Extrai UMA tag principal do clinicalMeta.
 * Lógica:
 * - Prioriza o campo "diagnostico" ou "quadro" (condição clínica)
 * - IGNORA "regiao" se já tem diagnóstico (evita redundância)
 * - Só usa "regiao" se não há diagnóstico (para não perder dados)
 * Retorna array com no máximo 1 tag normalizada por evolução.
 */
export function extractTagFromMeta(meta: Record<string, string | undefined> | undefined): string[] {
  if (!meta) return [];

  // Campos que contêm diagnóstico clínico (PRIORIDADE)
  const diagnosisKeys = ['diagnostico', 'quadro', 'patologia'];
  // Campos que contêm região anatômica (BACKUP)
  const regionKeys = ['regiao', 'regiao_foco', 'sistema'];
  // Campos secundários
  const secondaryKeys = ['especie', 'procedimento'];

  let diagnosisTag: string | null = null;
  let regionTag: string | null = null;

  // Tentar extrair diagnóstico
  for (const key of diagnosisKeys) {
    const value = meta[key];
    if (value && typeof value === 'string' && value.trim() !== '') {
      const normalized = normalizeToUmbrella(value.trim());
      if (normalized) {
        diagnosisTag = normalized;
        break;
      }
    }
  }

  // Se tem diagnóstico, retorna SÓ ele (sem região para evitar redundância)
  if (diagnosisTag) {
    return [diagnosisTag];
  }

  // Se não tem diagnóstico, tentar região (mas só se não for pura anatomia)
  for (const key of regionKeys) {
    const value = meta[key];
    if (value && typeof value === 'string' && value.trim() !== '') {
      const normalized = normalizeToUmbrella(value.trim());
      if (normalized) {
        regionTag = normalized;
        break;
      }
    }
  }

  if (regionTag) {
    return [regionTag];
  }

  // Último recurso: campos secundários
  for (const key of secondaryKeys) {
    const value = meta[key];
    if (value && typeof value === 'string' && value.trim() !== '') {
      const normalized = normalizeToUmbrella(value.trim());
      if (normalized) return [normalized];
    }
  }

  return [];
}
