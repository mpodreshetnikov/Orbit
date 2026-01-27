-- ============================================================================
-- FINDING TYPE CATALOG TABLE
-- Reference table for standardized medical finding types
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.finding_type_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Unique code for the finding type (e.g., "polyp", "stone", "cyst")
  finding_code text NOT NULL UNIQUE,
  
  -- Localized names
  name_ru text NOT NULL,
  name_en text NOT NULL,
  
  -- Synonyms for matching from OCR/LLM extraction (lowercase for matching)
  synonyms_ru text[] NOT NULL DEFAULT '{}',
  synonyms_en text[] NOT NULL DEFAULT '{}',
  
  -- Optional notes about the finding type
  notes text,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS (read-only for authenticated users)
ALTER TABLE public.finding_type_catalog ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Authenticated users can read the catalog
CREATE POLICY "Authenticated users can read finding type catalog"
  ON public.finding_type_catalog FOR SELECT TO authenticated
  USING (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_finding_type_catalog_code 
  ON public.finding_type_catalog(finding_code);

-- GIN indexes for array searches (synonym matching)
CREATE INDEX IF NOT EXISTS idx_finding_type_catalog_synonyms_ru 
  ON public.finding_type_catalog USING GIN(synonyms_ru);
CREATE INDEX IF NOT EXISTS idx_finding_type_catalog_synonyms_en 
  ON public.finding_type_catalog USING GIN(synonyms_en);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_finding_type_catalog_updated_at
  BEFORE UPDATE ON public.finding_type_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- BODY SITE CATALOG TABLE
-- Reference table for standardized anatomical locations
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.body_site_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Unique code for the body site (e.g., "colon_sigmoid", "kidney_left")
  site_code text NOT NULL UNIQUE,
  
  -- Localized names
  name_ru text NOT NULL,
  name_en text NOT NULL,
  
  -- Optional parent site for hierarchy (e.g., "kidney" is parent of "kidney_left")
  parent_site_code text REFERENCES public.body_site_catalog(site_code) ON DELETE SET NULL,
  
  -- Synonyms for matching from OCR/LLM extraction (lowercase for matching)
  synonyms_ru text[] NOT NULL DEFAULT '{}',
  synonyms_en text[] NOT NULL DEFAULT '{}',
  
  -- Optional notes about the body site
  notes text,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS (read-only for authenticated users)
ALTER TABLE public.body_site_catalog ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Authenticated users can read the catalog
CREATE POLICY "Authenticated users can read body site catalog"
  ON public.body_site_catalog FOR SELECT TO authenticated
  USING (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_body_site_catalog_code 
  ON public.body_site_catalog(site_code);
CREATE INDEX IF NOT EXISTS idx_body_site_catalog_parent 
  ON public.body_site_catalog(parent_site_code);

-- GIN indexes for array searches (synonym matching)
CREATE INDEX IF NOT EXISTS idx_body_site_catalog_synonyms_ru 
  ON public.body_site_catalog USING GIN(synonyms_ru);
CREATE INDEX IF NOT EXISTS idx_body_site_catalog_synonyms_en 
  ON public.body_site_catalog USING GIN(synonyms_en);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_body_site_catalog_updated_at
  BEFORE UPDATE ON public.body_site_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- SEED DATA: Finding Type Catalog
-- ============================================================================

INSERT INTO public.finding_type_catalog (finding_code, name_ru, name_en, synonyms_ru, synonyms_en, notes)
VALUES
  -- Common findings
  ('polyp', 'Полип', 'Polyp', 
   ARRAY['полип', 'полипозное образование', 'полипоидное образование', 'полипы'],
   ARRAY['polyp', 'polypoid lesion', 'polyps'],
   'Abnormal tissue growth projecting from mucous membrane'),
  
  ('cyst', 'Киста', 'Cyst',
   ARRAY['киста', 'кистозное образование', 'кисты'],
   ARRAY['cyst', 'cystic lesion', 'cysts'],
   'Fluid-filled sac'),
  
  ('stone', 'Камень', 'Stone',
   ARRAY['камень', 'конкремент', 'калькулез', 'камни', 'конкременты'],
   ARRAY['stone', 'calculus', 'calculi', 'stones'],
   'Hard deposit (kidney stones, gallstones, etc.)'),
  
  ('nodule', 'Узел', 'Nodule',
   ARRAY['узел', 'узелок', 'узловое образование', 'узлы'],
   ARRAY['nodule', 'node', 'nodular lesion', 'nodules'],
   'Small solid mass'),
  
  ('mass', 'Образование', 'Mass',
   ARRAY['образование', 'новообразование', 'объёмное образование', 'опухоль'],
   ARRAY['mass', 'tumor', 'tumour', 'neoplasm', 'growth'],
   'Abnormal growth or lump'),
  
  ('lesion', 'Поражение', 'Lesion',
   ARRAY['поражение', 'очаг', 'очаговое образование'],
   ARRAY['lesion', 'focal lesion'],
   'Area of abnormal tissue'),
  
  ('calcification', 'Кальцинат', 'Calcification',
   ARRAY['кальцинат', 'кальциноз', 'обызвествление', 'кальцинаты'],
   ARRAY['calcification', 'calcium deposit'],
   'Calcium deposits in tissue'),
  
  ('thickening', 'Утолщение', 'Thickening',
   ARRAY['утолщение', 'утолщённый'],
   ARRAY['thickening', 'thickened'],
   'Abnormal tissue thickening'),
  
  ('stricture', 'Стриктура', 'Stricture',
   ARRAY['стриктура', 'сужение', 'стеноз'],
   ARRAY['stricture', 'stenosis', 'narrowing'],
   'Abnormal narrowing'),
  
  ('hernia', 'Грыжа', 'Hernia',
   ARRAY['грыжа', 'грыжевое выпячивание'],
   ARRAY['hernia', 'herniation'],
   'Protrusion of organ through cavity wall'),
  
  ('effusion', 'Выпот', 'Effusion',
   ARRAY['выпот', 'жидкость', 'скопление жидкости'],
   ARRAY['effusion', 'fluid collection'],
   'Abnormal fluid collection'),
  
  ('abscess', 'Абсцесс', 'Abscess',
   ARRAY['абсцесс', 'гнойник', 'нагноение'],
   ARRAY['abscess'],
   'Collection of pus'),
  
  ('fistula', 'Свищ', 'Fistula',
   ARRAY['свищ', 'фистула'],
   ARRAY['fistula'],
   'Abnormal connection between organs'),
  
  ('diverticulum', 'Дивертикул', 'Diverticulum',
   ARRAY['дивертикул', 'дивертикулы', 'дивертикулёз'],
   ARRAY['diverticulum', 'diverticula', 'diverticulosis'],
   'Pouch in intestinal wall'),
  
  ('erosion', 'Эрозия', 'Erosion',
   ARRAY['эрозия', 'эрозивный'],
   ARRAY['erosion', 'erosive'],
   'Surface tissue loss'),
  
  ('ulcer', 'Язва', 'Ulcer',
   ARRAY['язва', 'язвенный'],
   ARRAY['ulcer', 'ulceration'],
   'Deep tissue loss'),
  
  ('inflammation', 'Воспаление', 'Inflammation',
   ARRAY['воспаление', 'воспалительный процесс', 'воспалительные изменения'],
   ARRAY['inflammation', 'inflammatory changes'],
   'Tissue inflammation'),
  
  ('atrophy', 'Атрофия', 'Atrophy',
   ARRAY['атрофия', 'атрофические изменения'],
   ARRAY['atrophy', 'atrophic changes'],
   'Tissue wasting'),
  
  ('hypertrophy', 'Гипертрофия', 'Hypertrophy',
   ARRAY['гипертрофия', 'увеличение'],
   ARRAY['hypertrophy', 'enlargement'],
   'Tissue overgrowth'),
  
  ('fibrosis', 'Фиброз', 'Fibrosis',
   ARRAY['фиброз', 'фиброзные изменения', 'склероз'],
   ARRAY['fibrosis', 'fibrotic changes', 'sclerosis'],
   'Scarring/fibrous tissue'),
  
  ('aneurysm', 'Аневризма', 'Aneurysm',
   ARRAY['аневризма'],
   ARRAY['aneurysm'],
   'Vessel wall bulging'),
  
  ('thrombosis', 'Тромбоз', 'Thrombosis',
   ARRAY['тромбоз', 'тромб'],
   ARRAY['thrombosis', 'thrombus', 'clot'],
   'Blood clot'),
  
  ('hemorrhage', 'Кровоизлияние', 'Hemorrhage',
   ARRAY['кровоизлияние', 'гематома', 'кровотечение'],
   ARRAY['hemorrhage', 'hematoma', 'bleeding'],
   'Bleeding'),
  
  ('adhesion', 'Спайка', 'Adhesion',
   ARRAY['спайка', 'спаечный процесс', 'спайки'],
   ARRAY['adhesion', 'adhesions'],
   'Abnormal tissue binding'),
  
  ('deviation', 'Искривление', 'Deviation',
   ARRAY['искривление', 'девиация', 'отклонение'],
   ARRAY['deviation', 'curvature'],
   'Abnormal curvature or position'),
  
  ('perforation', 'Перфорация', 'Perforation',
   ARRAY['перфорация', 'прободение'],
   ARRAY['perforation'],
   'Hole in organ wall'),
  
  ('prolapse', 'Пролапс', 'Prolapse',
   ARRAY['пролапс', 'выпадение', 'опущение'],
   ARRAY['prolapse'],
   'Organ displacement downward'),
  
  ('reflux', 'Рефлюкс', 'Reflux',
   ARRAY['рефлюкс', 'заброс'],
   ARRAY['reflux'],
   'Backward flow'),
  
  ('metaplasia', 'Метаплазия', 'Metaplasia',
   ARRAY['метаплазия'],
   ARRAY['metaplasia'],
   'Cell type transformation'),
  
  ('dysplasia', 'Дисплазия', 'Dysplasia',
   ARRAY['дисплазия'],
   ARRAY['dysplasia'],
   'Abnormal cell development')
ON CONFLICT (finding_code) DO UPDATE SET
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  synonyms_ru = EXCLUDED.synonyms_ru,
  synonyms_en = EXCLUDED.synonyms_en,
  notes = EXCLUDED.notes,
  updated_at = now();

-- ============================================================================
-- SEED DATA: Body Site Catalog
-- Organized by anatomical system
-- ============================================================================

-- First insert parent sites (no parent_site_code)
INSERT INTO public.body_site_catalog (site_code, name_ru, name_en, parent_site_code, synonyms_ru, synonyms_en, notes)
VALUES
  -- === GASTROINTESTINAL SYSTEM ===
  ('esophagus', 'Пищевод', 'Esophagus', NULL,
   ARRAY['пищевод'],
   ARRAY['esophagus', 'oesophagus'],
   'GI: Esophagus'),
  
  ('stomach', 'Желудок', 'Stomach', NULL,
   ARRAY['желудок'],
   ARRAY['stomach', 'gastric'],
   'GI: Stomach'),
  
  ('duodenum', 'Двенадцатиперстная кишка', 'Duodenum', NULL,
   ARRAY['двенадцатиперстная кишка', 'дпк', '12-перстная кишка'],
   ARRAY['duodenum', 'duodenal'],
   'GI: Duodenum'),
  
  ('small_intestine', 'Тонкая кишка', 'Small intestine', NULL,
   ARRAY['тонкая кишка', 'тонкий кишечник'],
   ARRAY['small intestine', 'small bowel'],
   'GI: Small intestine'),
  
  ('colon', 'Толстая кишка', 'Colon', NULL,
   ARRAY['толстая кишка', 'ободочная кишка', 'толстый кишечник'],
   ARRAY['colon', 'large intestine', 'large bowel'],
   'GI: Colon (parent)'),
  
  ('rectum', 'Прямая кишка', 'Rectum', NULL,
   ARRAY['прямая кишка', 'ректум'],
   ARRAY['rectum', 'rectal'],
   'GI: Rectum'),
  
  ('anus', 'Анальный канал', 'Anus', NULL,
   ARRAY['анальный канал', 'анус', 'задний проход'],
   ARRAY['anus', 'anal canal'],
   'GI: Anus'),
  
  ('liver', 'Печень', 'Liver', NULL,
   ARRAY['печень', 'печёночный'],
   ARRAY['liver', 'hepatic'],
   'GI: Liver'),
  
  ('gallbladder', 'Желчный пузырь', 'Gallbladder', NULL,
   ARRAY['желчный пузырь', 'жп'],
   ARRAY['gallbladder', 'gall bladder'],
   'GI: Gallbladder'),
  
  ('bile_ducts', 'Желчные протоки', 'Bile ducts', NULL,
   ARRAY['желчные протоки', 'желчевыводящие пути'],
   ARRAY['bile ducts', 'biliary'],
   'GI: Bile ducts'),
  
  ('pancreas', 'Поджелудочная железа', 'Pancreas', NULL,
   ARRAY['поджелудочная железа', 'панкреас'],
   ARRAY['pancreas', 'pancreatic'],
   'GI: Pancreas'),
  
  ('spleen', 'Селезёнка', 'Spleen', NULL,
   ARRAY['селезёнка', 'селезенка'],
   ARRAY['spleen', 'splenic'],
   'Spleen'),
  
  -- === URINARY SYSTEM ===
  ('kidney', 'Почка', 'Kidney', NULL,
   ARRAY['почка', 'почки'],
   ARRAY['kidney', 'renal'],
   'Urinary: Kidney (parent)'),
  
  ('ureter', 'Мочеточник', 'Ureter', NULL,
   ARRAY['мочеточник'],
   ARRAY['ureter', 'ureteral'],
   'Urinary: Ureter'),
  
  ('bladder', 'Мочевой пузырь', 'Bladder', NULL,
   ARRAY['мочевой пузырь'],
   ARRAY['bladder', 'urinary bladder', 'vesical'],
   'Urinary: Bladder'),
  
  ('urethra', 'Уретра', 'Urethra', NULL,
   ARRAY['уретра', 'мочеиспускательный канал'],
   ARRAY['urethra', 'urethral'],
   'Urinary: Urethra'),
  
  -- === REPRODUCTIVE SYSTEM ===
  ('prostate', 'Простата', 'Prostate', NULL,
   ARRAY['простата', 'предстательная железа'],
   ARRAY['prostate', 'prostatic'],
   'Male: Prostate'),
  
  ('testis', 'Яичко', 'Testis', NULL,
   ARRAY['яичко', 'яички', 'тестикула'],
   ARRAY['testis', 'testicle', 'testes'],
   'Male: Testis'),
  
  ('uterus', 'Матка', 'Uterus', NULL,
   ARRAY['матка'],
   ARRAY['uterus', 'uterine'],
   'Female: Uterus'),
  
  ('ovary', 'Яичник', 'Ovary', NULL,
   ARRAY['яичник', 'яичники'],
   ARRAY['ovary', 'ovarian', 'ovaries'],
   'Female: Ovary (parent)'),
  
  ('fallopian_tube', 'Маточная труба', 'Fallopian tube', NULL,
   ARRAY['маточная труба', 'фаллопиева труба'],
   ARRAY['fallopian tube', 'salpinx'],
   'Female: Fallopian tube'),
  
  ('cervix', 'Шейка матки', 'Cervix', NULL,
   ARRAY['шейка матки', 'цервикс'],
   ARRAY['cervix', 'cervical'],
   'Female: Cervix'),
  
  ('vagina', 'Влагалище', 'Vagina', NULL,
   ARRAY['влагалище'],
   ARRAY['vagina', 'vaginal'],
   'Female: Vagina'),
  
  ('breast', 'Молочная железа', 'Breast', NULL,
   ARRAY['молочная железа', 'грудь'],
   ARRAY['breast', 'mammary'],
   'Breast (parent)'),
  
  -- === RESPIRATORY SYSTEM ===
  ('nasal_cavity', 'Полость носа', 'Nasal cavity', NULL,
   ARRAY['полость носа', 'носовая полость', 'нос'],
   ARRAY['nasal cavity', 'nose'],
   'Respiratory: Nasal cavity'),
  
  ('nasal_septum', 'Носовая перегородка', 'Nasal septum', NULL,
   ARRAY['носовая перегородка', 'перегородка носа'],
   ARRAY['nasal septum', 'septum'],
   'Respiratory: Nasal septum'),
  
  ('sinuses', 'Пазухи', 'Sinuses', NULL,
   ARRAY['пазухи', 'придаточные пазухи', 'околоносовые пазухи'],
   ARRAY['sinuses', 'paranasal sinuses'],
   'Respiratory: Sinuses (parent)'),
  
  ('pharynx', 'Глотка', 'Pharynx', NULL,
   ARRAY['глотка'],
   ARRAY['pharynx', 'pharyngeal'],
   'Respiratory: Pharynx'),
  
  ('larynx', 'Гортань', 'Larynx', NULL,
   ARRAY['гортань'],
   ARRAY['larynx', 'laryngeal'],
   'Respiratory: Larynx'),
  
  ('trachea', 'Трахея', 'Trachea', NULL,
   ARRAY['трахея'],
   ARRAY['trachea', 'tracheal'],
   'Respiratory: Trachea'),
  
  ('bronchi', 'Бронхи', 'Bronchi', NULL,
   ARRAY['бронхи', 'бронх'],
   ARRAY['bronchi', 'bronchus', 'bronchial'],
   'Respiratory: Bronchi'),
  
  ('lung', 'Лёгкое', 'Lung', NULL,
   ARRAY['лёгкое', 'легкое', 'лёгкие', 'легкие'],
   ARRAY['lung', 'pulmonary', 'lungs'],
   'Respiratory: Lung (parent)'),
  
  ('pleura', 'Плевра', 'Pleura', NULL,
   ARRAY['плевра', 'плевральный'],
   ARRAY['pleura', 'pleural'],
   'Respiratory: Pleura'),
  
  -- === CARDIOVASCULAR SYSTEM ===
  ('heart', 'Сердце', 'Heart', NULL,
   ARRAY['сердце', 'сердечный'],
   ARRAY['heart', 'cardiac'],
   'Cardiovascular: Heart'),
  
  ('aorta', 'Аорта', 'Aorta', NULL,
   ARRAY['аорта', 'аортальный'],
   ARRAY['aorta', 'aortic'],
   'Cardiovascular: Aorta'),
  
  ('carotid_artery', 'Сонная артерия', 'Carotid artery', NULL,
   ARRAY['сонная артерия', 'каротидная артерия'],
   ARRAY['carotid artery', 'carotid'],
   'Cardiovascular: Carotid'),
  
  -- === NERVOUS SYSTEM ===
  ('brain', 'Головной мозг', 'Brain', NULL,
   ARRAY['головной мозг', 'мозг'],
   ARRAY['brain', 'cerebral'],
   'Nervous: Brain'),
  
  ('spinal_cord', 'Спинной мозг', 'Spinal cord', NULL,
   ARRAY['спинной мозг'],
   ARRAY['spinal cord'],
   'Nervous: Spinal cord'),
  
  ('spine', 'Позвоночник', 'Spine', NULL,
   ARRAY['позвоночник', 'позвоночный столб'],
   ARRAY['spine', 'spinal', 'vertebral'],
   'Spine (parent)'),
  
  -- === ENDOCRINE SYSTEM ===
  ('thyroid', 'Щитовидная железа', 'Thyroid', NULL,
   ARRAY['щитовидная железа', 'щитовидка', 'щж'],
   ARRAY['thyroid', 'thyroid gland'],
   'Endocrine: Thyroid'),
  
  ('adrenal', 'Надпочечник', 'Adrenal gland', NULL,
   ARRAY['надпочечник', 'надпочечники'],
   ARRAY['adrenal', 'adrenal gland'],
   'Endocrine: Adrenal (parent)'),
  
  ('pituitary', 'Гипофиз', 'Pituitary gland', NULL,
   ARRAY['гипофиз'],
   ARRAY['pituitary', 'pituitary gland'],
   'Endocrine: Pituitary'),
  
  -- === LYMPHATIC SYSTEM ===
  ('lymph_node', 'Лимфатический узел', 'Lymph node', NULL,
   ARRAY['лимфатический узел', 'лимфоузел', 'лимфоузлы'],
   ARRAY['lymph node', 'lymph nodes'],
   'Lymphatic: Lymph node'),
  
  -- === MUSCULOSKELETAL ===
  ('joint', 'Сустав', 'Joint', NULL,
   ARRAY['сустав', 'суставы'],
   ARRAY['joint', 'articular'],
   'MSK: Joint (generic)'),
  
  ('muscle', 'Мышца', 'Muscle', NULL,
   ARRAY['мышца', 'мышцы'],
   ARRAY['muscle', 'muscular'],
   'MSK: Muscle (generic)'),
  
  -- === SKIN ===
  ('skin', 'Кожа', 'Skin', NULL,
   ARRAY['кожа', 'кожный покров'],
   ARRAY['skin', 'cutaneous', 'dermal'],
   'Skin'),
  
  -- === EYES ===
  ('eye', 'Глаз', 'Eye', NULL,
   ARRAY['глаз', 'глаза'],
   ARRAY['eye', 'ocular', 'eyes'],
   'Eye (parent)')
ON CONFLICT (site_code) DO UPDATE SET
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  parent_site_code = EXCLUDED.parent_site_code,
  synonyms_ru = EXCLUDED.synonyms_ru,
  synonyms_en = EXCLUDED.synonyms_en,
  notes = EXCLUDED.notes,
  updated_at = now();

-- Now insert child sites (with parent_site_code)
INSERT INTO public.body_site_catalog (site_code, name_ru, name_en, parent_site_code, synonyms_ru, synonyms_en, notes)
VALUES
  -- Colon subsites
  ('colon_cecum', 'Слепая кишка', 'Cecum', 'colon',
   ARRAY['слепая кишка', 'цекум'],
   ARRAY['cecum', 'caecum'],
   'GI: Cecum'),
  
  ('colon_ascending', 'Восходящая ободочная кишка', 'Ascending colon', 'colon',
   ARRAY['восходящая ободочная кишка', 'восходящий отдел'],
   ARRAY['ascending colon'],
   'GI: Ascending colon'),
  
  ('colon_transverse', 'Поперечная ободочная кишка', 'Transverse colon', 'colon',
   ARRAY['поперечная ободочная кишка', 'поперечный отдел'],
   ARRAY['transverse colon'],
   'GI: Transverse colon'),
  
  ('colon_descending', 'Нисходящая ободочная кишка', 'Descending colon', 'colon',
   ARRAY['нисходящая ободочная кишка', 'нисходящий отдел'],
   ARRAY['descending colon'],
   'GI: Descending colon'),
  
  ('colon_sigmoid', 'Сигмовидная кишка', 'Sigmoid colon', 'colon',
   ARRAY['сигмовидная кишка', 'сигма'],
   ARRAY['sigmoid colon', 'sigmoid'],
   'GI: Sigmoid colon'),
  
  -- Kidney subsites
  ('kidney_left', 'Левая почка', 'Left kidney', 'kidney',
   ARRAY['левая почка'],
   ARRAY['left kidney'],
   'Urinary: Left kidney'),
  
  ('kidney_right', 'Правая почка', 'Right kidney', 'kidney',
   ARRAY['правая почка'],
   ARRAY['right kidney'],
   'Urinary: Right kidney'),
  
  -- Ovary subsites
  ('ovary_left', 'Левый яичник', 'Left ovary', 'ovary',
   ARRAY['левый яичник'],
   ARRAY['left ovary'],
   'Female: Left ovary'),
  
  ('ovary_right', 'Правый яичник', 'Right ovary', 'ovary',
   ARRAY['правый яичник'],
   ARRAY['right ovary'],
   'Female: Right ovary'),
  
  -- Breast subsites
  ('breast_left', 'Левая молочная железа', 'Left breast', 'breast',
   ARRAY['левая молочная железа', 'левая грудь'],
   ARRAY['left breast'],
   'Left breast'),
  
  ('breast_right', 'Правая молочная железа', 'Right breast', 'breast',
   ARRAY['правая молочная железа', 'правая грудь'],
   ARRAY['right breast'],
   'Right breast'),
  
  -- Lung subsites
  ('lung_left', 'Левое лёгкое', 'Left lung', 'lung',
   ARRAY['левое лёгкое', 'левое легкое'],
   ARRAY['left lung'],
   'Respiratory: Left lung'),
  
  ('lung_right', 'Правое лёгкое', 'Right lung', 'lung',
   ARRAY['правое лёгкое', 'правое легкое'],
   ARRAY['right lung'],
   'Respiratory: Right lung'),
  
  -- Adrenal subsites
  ('adrenal_left', 'Левый надпочечник', 'Left adrenal', 'adrenal',
   ARRAY['левый надпочечник'],
   ARRAY['left adrenal'],
   'Endocrine: Left adrenal'),
  
  ('adrenal_right', 'Правый надпочечник', 'Right adrenal', 'adrenal',
   ARRAY['правый надпочечник'],
   ARRAY['right adrenal'],
   'Endocrine: Right adrenal'),
  
  -- Eye subsites
  ('eye_left', 'Левый глаз', 'Left eye', 'eye',
   ARRAY['левый глаз'],
   ARRAY['left eye'],
   'Left eye'),
  
  ('eye_right', 'Правый глаз', 'Right eye', 'eye',
   ARRAY['правый глаз'],
   ARRAY['right eye'],
   'Right eye'),
  
  -- Sinuses subsites
  ('sinus_maxillary', 'Гайморова пазуха', 'Maxillary sinus', 'sinuses',
   ARRAY['гайморова пазуха', 'верхнечелюстная пазуха'],
   ARRAY['maxillary sinus'],
   'Respiratory: Maxillary sinus'),
  
  ('sinus_frontal', 'Лобная пазуха', 'Frontal sinus', 'sinuses',
   ARRAY['лобная пазуха'],
   ARRAY['frontal sinus'],
   'Respiratory: Frontal sinus'),
  
  ('sinus_ethmoid', 'Решётчатая пазуха', 'Ethmoid sinus', 'sinuses',
   ARRAY['решётчатая пазуха', 'решетчатая пазуха'],
   ARRAY['ethmoid sinus'],
   'Respiratory: Ethmoid sinus'),
  
  ('sinus_sphenoid', 'Клиновидная пазуха', 'Sphenoid sinus', 'sinuses',
   ARRAY['клиновидная пазуха'],
   ARRAY['sphenoid sinus'],
   'Respiratory: Sphenoid sinus'),
  
  -- Spine subsites
  ('spine_cervical', 'Шейный отдел позвоночника', 'Cervical spine', 'spine',
   ARRAY['шейный отдел позвоночника', 'шейный отдел', 'шоп'],
   ARRAY['cervical spine', 'c-spine'],
   'Cervical spine'),
  
  ('spine_thoracic', 'Грудной отдел позвоночника', 'Thoracic spine', 'spine',
   ARRAY['грудной отдел позвоночника', 'грудной отдел'],
   ARRAY['thoracic spine', 't-spine'],
   'Thoracic spine'),
  
  ('spine_lumbar', 'Поясничный отдел позвоночника', 'Lumbar spine', 'spine',
   ARRAY['поясничный отдел позвоночника', 'поясничный отдел', 'поп'],
   ARRAY['lumbar spine', 'l-spine'],
   'Lumbar spine'),
  
  ('spine_sacral', 'Крестец', 'Sacrum', 'spine',
   ARRAY['крестец', 'крестцовый отдел'],
   ARRAY['sacrum', 'sacral'],
   'Sacrum')
ON CONFLICT (site_code) DO UPDATE SET
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  parent_site_code = EXCLUDED.parent_site_code,
  synonyms_ru = EXCLUDED.synonyms_ru,
  synonyms_en = EXCLUDED.synonyms_en,
  notes = EXCLUDED.notes,
  updated_at = now();
