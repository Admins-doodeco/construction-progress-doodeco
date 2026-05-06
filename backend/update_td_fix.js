const fs = require('fs');
let html = fs.readFileSync('../extension/construction_progress/ui/inspector.html', 'utf8');

// Fix the malformed tags from previous run
const cols = [
  'progress', 'area_finish', 'area_remaining', 'start_date', 'finish_date', 'material', 'supplier', 'as_built', 'ncr', 'remark', 'updated_date'
];

cols.forEach(col => {
  html = html.replace(new RegExp(`</td> v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), '</td>');
  html = html.replace(new RegExp(`<!-- Start Date --> v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), '<!-- Start Date -->');
  html = html.replace(new RegExp(`<!-- Finish Date --> v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), '<!-- Finish Date -->');
  html = html.replace(new RegExp(`<!-- Material --> v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), '<!-- Material -->');
  html = html.replace(new RegExp(`<!-- Supplier --> v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), '<!-- Supplier -->');
  html = html.replace(new RegExp(`<!-- NCR Zone Summary --> v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), '<!-- NCR Zone Summary -->');
  html = html.replace(new RegExp(`<!-- AS-BUILT \\(task row empty, shows on zone row\\) --> v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), '<!-- AS-BUILT (task row empty, shows on zone row) -->');
  html = html.replace(new RegExp(`<!-- NCR --> v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), '<!-- NCR -->');
  
  html = html.replace(new RegExp(`<input type="text" v-model="task.${col}" v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), `<input type="text" v-model="task.${col}"`);
  html = html.replace(new RegExp(`<input type="date" v-model="task.${col}" v-show="!hiddenColumns\\.includes\\('${col}'\\)"`, 'g'), `<input type="date" v-model="task.${col}"`);
});


const replacements = [
  // Group Row
  { pattern: /(<td class="px-2 py-2 font-bold text-indigo-700 text-right")({{ group.avgProgress }}%<\/td>)/g, rep: '$1 v-show="!hiddenColumns.includes(\'progress\')">$2' },
  { pattern: /(<td class="px-2 py-2 text-gray-600 text-right")({{ group.sumAreaFinish }}<\/td>)/g, rep: '$1 v-show="!hiddenColumns.includes(\'area_finish\')">$2' },
  { pattern: /(<td class="px-2 py-2 text-gray-600")({{ group.sumAreaRemaining }}<\/td>)/g, rep: '$1 v-show="!hiddenColumns.includes(\'area_remaining\')">$2' },
  { pattern: /(<td class="px-2 py-2 text-gray-600")(><\/td> <!-- Start Date -->)/g, rep: '$1 v-show="!hiddenColumns.includes(\'start_date\')"$2' },
  { pattern: /(<td class="px-2 py-2 text-gray-600")(><\/td> <!-- Finish Date -->)/g, rep: '$1 v-show="!hiddenColumns.includes(\'finish_date\')"$2' },
  { pattern: /(<td class="px-2 py-2 text-gray-600")(><\/td> <!-- Material -->)/g, rep: '$1 v-show="!hiddenColumns.includes(\'material\')"$2' },
  { pattern: /(<td class="px-2 py-2 text-gray-600")(><\/td> <!-- Supplier -->)/g, rep: '$1 v-show="!hiddenColumns.includes(\'supplier\')"$2' },
  { pattern: /(<td class="px-2 py-2 text-center bg-orange-50\/30")(> <!-- NCR Zone Summary -->)/g, rep: '$1 v-show="!hiddenColumns.includes(\'ncr\')"$2' },

  // Task Row
  { pattern: /(<td class="px-1 py-1")(><input type="text" v-model="task.progress")/g, rep: '$1 v-show="!hiddenColumns.includes(\'progress\')"$2' },
  { pattern: /(<td class="px-1 py-1")(><input type="text" v-model="task.area_finish")/g, rep: '$1 v-show="!hiddenColumns.includes(\'area_finish\')"$2' },
  { pattern: /(<td class="px-1 py-1")(><input type="text" v-model="task.area_remaining")/g, rep: '$1 v-show="!hiddenColumns.includes(\'area_remaining\')"$2' },
  { pattern: /(<td class="px-1 py-1")(><input type="date" v-model="task.start_date")/g, rep: '$1 v-show="!hiddenColumns.includes(\'start_date\')"$2' },
  { pattern: /(<td class="px-1 py-1")(><input type="date" v-model="task.finish_date")/g, rep: '$1 v-show="!hiddenColumns.includes(\'finish_date\')"$2' },
  { pattern: /(<td class="px-1 py-1")(><input type="text" v-model="task.material")/g, rep: '$1 v-show="!hiddenColumns.includes(\'material\')"$2' },
  { pattern: /(<td class="px-2 py-1.5")(><\/td> <!-- AS-BUILT \(task row empty, shows on zone row\) -->)/g, rep: '$1 v-show="!hiddenColumns.includes(\'as_built\')"$2' },
  { pattern: /(<td class="px-2 py-1 text-center bg-orange-50\/20")(> <!-- NCR -->)/g, rep: '$1 v-show="!hiddenColumns.includes(\'ncr\')"$2' },
  { pattern: /(<td class="px-1 py-1")(><input type="text" v-model="task.remark")/g, rep: '$1 v-show="!hiddenColumns.includes(\'remark\')"$2' },
  { pattern: /(<td class="px-1 py-1")(><input type="date" v-model="task.updated_date")/g, rep: '$1 v-show="!hiddenColumns.includes(\'updated_date\')"$2' },
];

replacements.forEach(col => {
  html = html.replace(col.pattern, col.rep);
});

fs.writeFileSync('../extension/construction_progress/ui/inspector.html', html);
