# សៀវភៅណែនាំដំឡើង និងដំណើរការជាមួយ Supabase (PAC Finance App)

ឯកសារនេះណែនាំអ្នកពីរបៀបភ្ជាប់កម្មវិធីគ្រប់គ្រងហិរញ្ញវត្ថុនេះទៅកាន់ **Supabase Cloud Database** ដើម្បីរក្សាទុកទិន្នន័យអនឡាញ និងប្រើប្រាស់បានច្រើនឧបករណ៍ក្នុងពេលតែមួយ។

---

## ជំហានទី ១៖ បង្កើតគម្រោងលើ Supabase (ឥតគិតថ្លៃ)

1. ចូលទៅកាន់គេហទំព័រ [https://supabase.com](https://supabase.com)
2. ចុច **Sign In** (អ្នកអាច Login ជាមួយគណនី GitHub ឬ Google បាន)
3. ចុចប៊ូតុង **"New Project"**
4. បំពេញព័ត៌មាន៖
   - **Name**: ដាក់ឈ្មោះគម្រោង (ឧទាហរណ៍៖ `pac-finance`)
   - **Database Password**: កំណត់លេខសម្ងាត់ Database របស់អ្នក (សូមចាំទុក)
   - **Region**: ជ្រើសរើសតំបន់ជិតកម្ពុជាបំផុត ដូចជា `Singapore (ap-southeast-1)`
   - **Pricing Plan**: ជ្រើសរើស **Free plan**
5. ចុច **"Create new project"** ហើយរង់ចាំប្រមាណ ១-២ នាទីឱ្យ Supabase រៀបចំប្រព័ន្ធចប់។

---

## ជំហានទី ២៖ បង្កើត Tables ក្នុង Supabase Database (Run SQL Schema)

1. នៅលើផ្ទាំង Supabase Dashboard ខាងឆ្វេងដៃ ចុចលើរូប **SQL Editor** (រូបតំណាង `>_` ឬ terminal)
2. ចុច **"New query"**
3. បើកឯកសារ [supabase_schema.sql](file:///d:/Pac_Finance_Management/supabase_schema.sql) ក្នុងកុំព្យូទ័ររបស់អ្នក រួច Copy កូដ SQL ទាំងអស់
4. យកមក **Paste** ចូលក្នុងប្រអប់ Query របស់ Supabase
5. ចុចប៊ូតុង **"Run"** (ឬចុច `Ctrl + Enter`)
6. អ្នកនឹងឃើញពាក្យ **"Success. No rows returned"** មានន័យថា Table `pac_ledger`, `pac_invoices` និង `pac_settings` (សម្រាប់ Sync លេខកូដ PIN ឆ្លង Device) ត្រូវបានបង្កើតដោយជោគជ័យ!

---

## ជំហានទី ៣៖ យក Supabase URL និង Anon API Key

1. នៅលើផ្ទាំង Dashboard របស់ Supabase ចុចលើ **Project Settings** (រូបកង់ធ្មេញ ⚙️ នៅជ្រុងខាងឆ្វេងក្រោម)
2. ចុចលើម៉ឺនុយ **Data API** (ឬ **API**)
3. អ្នកនឹងឃើញ៖
   - **Project URL**: មានទម្រង់ដូចជា `https://xxxxxxxxxxxxxxxxxxxx.supabase.co`
   - **Project API Keys** -> ចម្លងយកកូដពីប្រឡោះ **`anon` `public`** (ជាកូដ JWT វែងៗ)

---

## ជំហានទី ៤៖ ភ្ជាប់ជាមួយ Web App របស់អ្នក

មាន ២ ជម្រើសក្នុងការភ្ជាប់៖

### ជម្រើសទី ១ (ងាយស្រួលបំផុត តាមរយៈផ្ទាំង UI):
1. បើកកម្មវិធី Web App របស់អ្នក (បើក `index.html` តាមរយៈ Live Server ឬ Double-click)
2. នៅលើរបារខាងលើ ចុចលើប៊ូតុង **"⚙️ Supabase"**
3. បិទភ្ជាប់ (Paste)៖
   - **Supabase URL**
   - **Supabase Anon Key**
4. ចុច **"តេស្តការតភ្ជាប់"** ពេលឃើញពណ៌បៃតង ចុច **"រក្សាទុក និងភ្ជាប់"**
5. ប្រសិនបើអ្នកមានទិន្នន័យចាស់ក្នុងកុំព្យូទ័ររួចហើយ អ្នកអាចចុច **"ផ្ទេរទិន្នន័យចាស់ទៅ Supabase (Migrate Local Data)"** ដើម្បីរុញទិន្នន័យទាំងអស់ឡើង Cloud ភ្លាមៗ!

### ជម្រើសទី ២ (កំណត់ក្នុងកូដជាស្រេច):
បើកឯកសារ `supabase-config.js` ហើយបញ្ចូល URL និង Anon Key របស់អ្នក៖
```javascript
const SUPABASE_CONFIG = {
  url: 'https://xxxxxxxxxxxxxxxxxxxx.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};
```

---

## ជំហានទី ៥៖ របៀបដាក់ App ឱ្យដំណើរការលើអ៊ីនធឺណិត (Free Hosting)

អ្នកអាចបង្ហោះ Web App នេះឱ្យមនុស្សគ្រប់គ្នា ឬថ្នាក់ដឹកនាំអាចបើកមើលបានតាមរយៈទូរស័ព្ទ ឬកុំព្យូទ័រ៖
1. **Netlify Drop**: ចូលទៅកាន់ [app.netlify.com/drop](https://app.netlify.com/drop) រួចអូសទាញ Folder `Pac_Finance_Management` ទម្លាក់ចូល នោះអ្នកនឹងទទួលបាន Link ដំណើរការភ្លាមៗ (ឧ. `https://pac-finance.netlify.app`)។
2. **Vercel**: ចូល [vercel.com](https://vercel.com) ជ្រើសរើស Folder ឬភ្ជាប់តាម GitHub។
3. **GitHub Pages**: បង្កើត GitHub Repository រួចបើក Settings -> Pages ជ្រើសរើស branch `main`។

---

## ជំហានទី ៦៖ ការប្រើប្រាស់មុខងារភ្ជាប់រូបភាពវិក្កយបត្រ (Receipt Images)

1. ចូលទៅកាន់ Tab **«របាយការណ៍វិក្កយបត្រថ្នាក់ដឹកនាំ»**
2. នៅត្រង់ជួរឈរ **«បង្កាន់ដៃ/រូប»**៖
   - ចុចលើប៊ូតុង **"Upload"** (រូបកាមេរ៉ា) ដើម្បីជ្រើសរើសរូបភាពវិក្កយបត្រ (PNG, JPG)
   - រូបភាពនឹងត្រូវបានបង្ហោះទៅកាន់ Supabase Storage Bucket `pac_receipts` ដោយស្វ័យប្រវត្តិ
   - បន្ទាប់ពី Upload រួច ប៊ូតុងនឹងប្តូរទៅជាពណ៌ខៀវ **"មើល"**
3. ចុចលើប៊ូតុង **"មើល"** ដើម្បីបើកផ្ទាំងរូបភាពធំ (Full Resolution Preview) ដែលមានប៊ូតុង៖
   - ពង្រីក / បង្រួម (Zoom In / Zoom Out)
   - ទាញយករូបភាព (Download)
   - ប្តូររូបភាពថ្មី ឬលុបរូបភាព (សម្រាប់តែអ្នកកត់ត្រា)

---

## ជំហានទី ៧៖ ការប្រើប្រាស់ប្រព័ន្ធកំណត់សិទ្ធិ (Role-Based Access Control)

នៅលើរបារ Menu ខាងលើ មានប៊ូតុងបង្ហាញសិទ្ធិបច្ចុប្បន្ន (ឧ. `[👤 អ្នកកត់ត្រា]` ឬ `[👤 ថ្នាក់ដឹកនាំ]`):
1. ចុចលើប៊ូតុងនោះដើម្បីបើកផ្ទាំង **«ប្រព័ន្ធកំណត់សិទ្ធិ និងគណនី»**
2. **សិទ្ធិអ្នកកត់ត្រា (Editor Mode)**៖
   - មានសិទ្ធិពេញលេញក្នុងការបញ្ចូល កែសម្រួល លុបជួរ និង Upload រូបភាពវិក្កយបត្រ
3. **សិទ្ធិថ្នាក់ដឹកនាំ (Viewer Mode / Read-Only)**៖
   - ប្រព័ន្ធនឹង **Lock ការកែប្រែទាំងអស់ដោយស្វ័យប្រវត្តិ** (បិទការវាយបញ្ចូល)
   - លាក់ប៊ូតុងបន្ថែមជួរ និងប៊ូតុងលុប
   - អនុញ្ញាតឱ្យថ្នាក់ដឹកនាំអាច៖ មើលស្ថិតិ ពិនិត្យវិក្កយបត្រ ចុចមើលរូបភាពបង្កាន់ដៃ និងទាញរបាយការណ៍ជា **Export PDF** ដោយមិនបារម្ភរឿងច្រឡំដៃកែប្រែទិន្នន័យដើម!
