const fs = require('fs');
let html = fs.readFileSync('../extension/construction_progress/ui/inspector.html', 'utf8');

const cols = [
  // Group Row
  { name: 'progress', pattern: /(<td class="px-2 py-2 font-bold text-indigo-700 text-right">{{ group.avgProgress }}%<\/td>)/g },
  { name: 'area_finish', pattern: /(<td class="px-2 py-2 text-gray-600 text-right">{{ group.sumAreaFinish }}<\/td>)/g },
  { name: 'area_remaining', pattern: /(<td class="px-2 py-2 text-gray-600">{{ group.sumAreaRemaining }}<\/td>)/g },
  { name: 'start_date', pattern: /(<td class="px-2 py-2 text-gray-600"><\/td> <!-- Start Date -->)/g },
  { name: 'finish_date', pattern: /(<td class="px-2 py-2 text-gray-600"><\/td> <!-- Finish Date -->)/g },
  { name: 'material', pattern: /(<td class="px-2 py-2 text-gray-600"><\/td> <!-- Material -->)/g },
  { name: 'supplier', pattern: /(<td class="px-2 py-2 text-gray-600"><\/td> <!-- Supplier -->)/g },
  { name: 'as_built', pattern: /(<td class="px-2 py-2 text-gray-600"> <!-- AS-BUILT -->\n\s*<select v-model="group.as_built")/g, replace: '<td class="px-2 py-2 text-gray-600" v-show="!hiddenColumns.includes(\'as_built\')"> <!-- AS-BUILT -->\n                  <select v-model="group.as_built"' },
  { name: 'ncr', pattern: /(<td class="px-2 py-2 text-center bg-orange-50\/30"> <!-- NCR Zone Summary -->)/g },

  // Task Row
  { name: 'progress', pattern: /(<td class="px-1 py-1"><input type="text" v-model="task.progress")/g },
  { name: 'area_finish', pattern: /(<td class="px-1 py-1"><input type="text" v-model="task.area_finish")/g },
  { name: 'area_remaining', pattern: /(<td class="px-1 py-1"><input type="text" v-model="task.area_remaining")/g },
  { name: 'start_date', pattern: /(<td class="px-1 py-1"><input type="date" v-model="task.start_date")/g },
  { name: 'finish_date', pattern: /(<td class="px-1 py-1"><input type="date" v-model="task.finish_date")/g },
  { name: 'material', pattern: /(<td class="px-1 py-1"><input type="text" v-model="task.material")/g },
  { name: 'supplier', pattern: /(<td class="px-2 py-1.5 supplier-cell">\n\s*<span v-if="isEditor">{{ task.supplier }}<\/span>)/g, replace: '<td class="px-2 py-1.5 supplier-cell" v-show="!hiddenColumns.includes(\'supplier\')">\n                    <span v-if="isEditor">{{ task.supplier }}</span>' },
  { name: 'as_built', pattern: /(<td class="px-2 py-1.5"><\/td> <!-- AS-BUILT \(task row empty, shows on zone row\) -->)/g },
  { name: 'ncr', pattern: /(<td class="px-2 py-1 text-center bg-orange-50\/20"> <!-- NCR -->)/g },
  { name: 'remark', pattern: /(<td class="px-1 py-1"><input type="text" v-model="task.remark")/g },
  { name: 'updated_date', pattern: /(<td class="px-1 py-1"><input type="date" v-model="task.updated_date")/g },
];

cols.forEach(col => {
  if (col.replace) {
    html = html.replace(col.pattern, col.replace);
  } else {
    html = html.replace(col.pattern, `$1 v-show="!hiddenColumns.includes('${col.name}')"`);
  }
});

// Group row Summary colspan
html = html.replace(
  /(<td class="px-2 py-2 text-gray-400 italic" colspan=")3(">— Summary —<\/td>)/g,
  `<td class="px-2 py-2 text-gray-400 italic" :colspan="1 + (hiddenColumns.includes('remark') ? 0 : 1) + (hiddenColumns.includes('updated_date') ? 0 : 1)">— Summary —</td>`
);

fs.writeFileSync('../extension/construction_progress/ui/inspector.html', html);
