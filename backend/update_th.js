const fs = require('fs');
let html = fs.readFileSync('../extension/construction_progress/ui/inspector.html', 'utf8');

const cols = [
  { name: 'progress', pattern: /('progress', \$event\)"\s+class=".*?")/g },
  { name: 'area_finish', pattern: /('area_finish', \$event\)"\s+class=".*?")/g },
  { name: 'area_remaining', pattern: /('area_remaining', \$event\)"\s+class=".*?")/g },
  { name: 'start_date', pattern: /('start_date', \$event\)"\s+class=".*?")/g },
  { name: 'finish_date', pattern: /('finish_date', \$event\)"\s+class=".*?")/g },
  { name: 'material', pattern: /('material', \$event\)"\s+class=".*?")/g },
  { name: 'supplier', pattern: /('supplier', \$event\)"\s+class=".*?")/g },
  { name: 'as_built', pattern: /('as_built', \$event\)"\s+class=".*?")/g },
  { name: 'ncr', pattern: /(title="NCR: Major Defect Done \/ Total")/g },
  { name: 'remark', pattern: /('remark', \$event\)"\s+class=".*?")/g },
  { name: 'updated_date', pattern: /('updated_date', \$event\)"\s+class=".*?")/g },
];

cols.forEach(col => {
  html = html.replace(col.pattern, `$1 v-show="!hiddenColumns.includes('${col.name}')"`);
});

fs.writeFileSync('../extension/construction_progress/ui/inspector.html', html);
