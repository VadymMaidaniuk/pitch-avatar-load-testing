import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const out=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(out,'../..');
const source=path.join(root,'test-results/ws-load-aster-2026-09-28');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const summary=await read(path.join(source,'summary.json'));
const preflight=await read(path.join(source,'preflight.json'));
const reports=await Promise.all(summary.scenarios.map(e=>read(path.join(root,e.sourceFile))));
const workbook=Workbook.create();
const overview=workbook.worksheets.add('Зведення');
const detail=workbook.worksheets.add('Відповіді');
const controls=workbook.worksheets.add('Контрольні запити');
const font='Arial'; // Arial verified installed locally and supported by Google Sheets.
const headers=['Середовище','Сценарій','Сесія','Черга','ID питання','Повний текст, мс','Перший текст, мс','WS статус','Зміст','Питання','Відповідь','Надіслано UTC','scrUserID','messageId','traceId','Чанків','Подія завершення','Помилка','Зсув старту, мс','Тривалість, мс'];
const plain=v=>typeof v==='string' && v.startsWith('=') ? "'"+v : v;
function row(env,scenario,q,assessment) {
  const a=q.reply??{};
  return [env,scenario,q.session??1,q.turn,q.sourceQuestionId,a.fullTextMs??null,a.firstTextMs??null,q.status??a.status,assessment,q.question,a.text??'',a.sentAtUtc?new Date(a.sentAtUtc):null,q.scrUserID,a.messageId??'',a.traceId??'',a.chunks??0,a.completionEvent??'',q.error??a.error??'',q.startOffsetMs??null,a.elapsedMs??null].map(plain);
}
const raw=[];
const bounds=[];
for(const report of reports) {
  const first=raw.length+4;
  for(const q of report.questions) raw.push(row(report.environment,report.scenario.name,q,'correct'));
  bounds.push([first,raw.length+3]);
}
if(raw.length!==555) throw new Error('Expected 555 measured rows');
const controlRows=[];
for(const item of preflight) {
  item.report.replies.forEach((q,i)=>controlRows.push(row(item.report.environment,'preflight',{...q,turn:i+1,sourceQuestionId:i+1,scrUserID:item.report.metadata.scrUserID},'correct')));
}
function base(sheet,range) {
  const r=sheet.getRange(range);
  r.format.font={name:font,size:11,color:'#243247'};
  r.format.rowHeight=22;
  r.format.verticalAlignment='center';
  sheet.showGridLines=false;
}
function header(sheet,address) {
  sheet.getRange(address).format={fill:'#25466A',font:{name:font,size:11,bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:42,verticalAlignment:'center',horizontalAlignment:'center',borders:{insideVertical:{style:'thin',color:'#FFFFFF'}}};
}
function dataSheet(sheet,title,rows,tableName) {
  const end=rows.length+3;
  base(sheet,`A1:T${end}`);
  sheet.getRange('A1').values=[[title]];
  sheet.getRange('A1').format.font={name:font,size:15,bold:true,color:'#243247'};
  sheet.getRange('A2').values=[['28.09.2026. Час у мілісекундах, часові позначки UTC.']];
  sheet.getRange('A2').format.font={name:font,size:10,italic:true,color:'#5C6877'};
  sheet.getRange('A3:T3').values=[headers];
  sheet.getRange(`A4:T${end}`).values=rows;
  sheet.tables.add(`A3:T${end}`,true,tableName);
  header(sheet,'A3:T3');
  sheet.getRange(`A4:T${end}`).format.rowHeight=86;
  sheet.getRange(`A4:T${end}`).format.verticalAlignment='top';
  sheet.getRange(`J4:K${end}`).format.wrapText=true;
  sheet.getRange(`F4:G${end}`).setNumberFormat('0.000');
  sheet.getRange(`F4:G${end}`).format.horizontalAlignment='right';
  sheet.getRange(`S4:T${end}`).setNumberFormat('0.000');
  sheet.getRange(`L4:L${end}`).setNumberFormat('yyyy-mm-dd hh:mm:ss.000');
  sheet.getRange(`M4:O${end}`).setNumberFormat('@');
  const widths=[125,135,60,60,70,130,130,90,90,430,480,190,95,320,320,60,200,140,115,115];
  widths.forEach((width,i)=>sheet.getRangeByIndexes(0,i,end,1).format.columnWidthPx=width);
  sheet.freezePanes.freezeRows(3);
  sheet.freezePanes.freezeColumns(2);
}
dataSheet(detail,'Відповіді аватарів',raw,'AvatarReplies');
dataSheet(controls,'Контрольні запити перед навантаженням',controlRows,'AvatarPreflight');
base(overview,'A1:M46');
overview.getRange('A1').values=[['WebSocket: результати навантаження']];
overview.getRange('A1').format.font={name:font,size:16,bold:true,color:'#243247'};
overview.getRange('A2').values=[['Aster Harbor Services. 28.09.2026. Послідовність середовищ: dev, stage, prod.']];
overview.getRange('A2').format.font={name:font,size:10,italic:true,color:'#5C6877'};
overview.getRange('A4:M4').values=[['Середовище','Сценарій','Сесій','План питань','Повних','Правильних','Помилок','Пропущено','Середнє, с','p50, с','p95, с','Максимум, с','Пік запитів']];
header(overview,'A4:M4');
for(let i=0;i<reports.length;i++) {
  const r=reports[i], rr=i+5, [start,end]=bounds[i];
  const time=`'Відповіді'!F${start}:F${end}`;
  const status=`'Відповіді'!H${start}:H${end}`;
  const quality=`'Відповіді'!I${start}:I${end}`;
  overview.getRange(`A${rr}:D${rr}`).values=[[r.environment,r.scenario.name,r.scenario.sessions,r.summary.plannedQuestions]];
  overview.getRange(`E${rr}:L${rr}`).formulas=[[
    `=COUNTIF(${status},"ok")`,`=COUNTIF(${quality},"correct")`,
    `=D${rr}-E${rr}-H${rr}`,`=COUNTIF(${status},"skipped")`,
    `=AVERAGE(${time})/1000`,`=SMALL(${time},ROUNDUP(COUNT(${time})*0.5,0))/1000`,
    `=SMALL(${time},ROUNDUP(COUNT(${time})*0.95,0))/1000`,`=MAX(${time})/1000`
  ]];
  overview.getRange(`M${rr}`).values=[[r.summary.peakInFlight]];
  if(i%2===0) overview.getRange(`A${rr}:M${rr}`).format.fill='#F1F5F9';
}
overview.getRange('I5:L16').setNumberFormat('0.000');
overview.getRange('A18').values=[['Разом']];
overview.getRange('C18:H18').formulas=[['=SUM(C5:C16)','=SUM(D5:D16)','=SUM(E5:E16)','=SUM(F5:F16)','=SUM(G5:G16)','=SUM(H5:H16)']];
overview.getRange('A18:M18').format.font={name:font,size:11,bold:true,color:'#243247'};
overview.getRange('A18:M18').format.borders={top:{style:'thin',color:'#95A4B5'}};

overview.getRange('A20').values=[['Додаткові метрики']];
overview.getRange('A20').format.font={name:font,size:12,bold:true,color:'#243247'};
overview.getRange('A21:L21').values=[['Середовище','Сценарій','Setup, с','Вікно Q&A, с','Відповідей/с','Розкид старту, мс','Мінімум, с','Перший текст середнє, с','Перший текст p50, с','Перший текст p95, с','Перший текст max, с','Помилок setup']];
header(overview,'A21:L21');
overview.getRange('A21:L21').format.rowHeight=60;
overview.getRange('A22:L33').values=reports.map(r=>{
  const s=r.summary;
  return [r.environment,r.scenario.name,s.setupWallMs/1000,s.responseWindowMs/1000,s.successfulRepliesPerSecond,s.firstWaveSendSpreadMs,s.fullText.minMs/1000,s.firstText.meanMs/1000,s.firstText.p50Ms/1000,s.firstText.p95Ms/1000,s.firstText.maxMs/1000,s.failedSetupAttempts];
});
overview.getRange('C22:K33').setNumberFormat('0.000');
overview.getRange('A35').values=[['Методика та джерела']];
overview.getRange('A35').format.font={name:font,size:12,bold:true,color:'#243247'};
const notes=[
  'Час відповіді: від надсилання питання через WS до повного тексту. HTTP setup та закриття сокетів виключено.',
  'У кожній сесії наступне питання надсилалося після відповіді. У паралельних групах використано питання 8 та 14.',
  'p50 і p95: nearest rank. 9 контрольних запитів з окремої вкладки не входять до 555 вимірювань.',
  'Усі 555 текстів запитів унікальні завдяки буквено-цифровим кодам. cacheEnabled=true; відсутність кешування не підтверджена.',
  'Кожний сценарій виконано один раз. Результати описують ці короткі прогони, а не тривалу пропускну здатність чи SLA.',
  'Усі відповіді: assistant_chat_message. Перший текст надходив разом із повною відповіддю. Медіапідключення не відкривалися.',
  'Зміст перевірено за заданими фактами. 34 різні тексти відповідей перевірено; ідентичні відповіді успадковують перевірку.',
  'Джерела: results.json для 12 сценаріїв, summary.json, reviewed-answers.json та preflight.json; дата тесту 28.09.2026.'
];
notes.forEach((s,i)=>overview.getRange(`A${36+i}`).values=[[s]]);
overview.getRange('A44:B46').values=[['Dev','https://slides-dev.pitchavatar.com/1eipe'],['Stage','https://slides-staging.pitchavatar.com/wwqbg'],['Prod','https://slides.pitchavatar.com/suwoy']];
const widths=[115,150,100,115,110,125,100,145,120,125,130,115,105];
widths.forEach((w,i)=>overview.getRangeByIndexes(0,i,46,1).format.columnWidthPx=w);
overview.getRange('A36:M43').format.font={name:font,size:10,color:'#5C6877'};
overview.getRange('A36:M43').format.rowHeight=23;

console.log((await workbook.inspect({kind:'table',range:'Зведення!C18:H18',include:'values,formulas',tableMaxRows:1,tableMaxCols:6,maxChars:2000})).ndjson);
console.log((await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},summary:'Formula error scan',maxChars:2000})).ndjson);
for(let i=0;i<reports.length;i++) {
  const [mean,p50,p95,max]=overview.getRange(`I${i+5}:L${i+5}`).values[0];
  const m=reports[i].summary.fullText;
  for(const [actual,expected] of [[mean,m.meanMs/1000],[p50,m.p50Ms/1000],[p95,m.p95Ms/1000],[max,m.maxMs/1000]]) {
    if(typeof actual!=='number' || Math.abs(actual-expected)>1e-7) throw new Error(`Formula mismatch row ${i+5}: ${actual}, expected ${expected}`);
  }
}
const totals=overview.getRange('C18:H18').values[0];
if(JSON.stringify(totals)!==JSON.stringify([243,555,555,555,0,0])) throw new Error(`Wrong totals: ${totals}`);
for(const [sheet,range,file] of [['Зведення','A1:M18','summary-preview.png'],['Зведення','A20:M46','method-preview.png'],['Відповіді','A1:K6','answers-preview.png'],['Контрольні запити','A1:K6','preflight-preview.png']]) {
  if(process.env.RERENDER_DETAILS==='1' && sheet==='Зведення') continue;
  const image=await workbook.render({sheetName:sheet,range,scale:1.3,format:'png'});
  await fs.writeFile(path.join(out,file),new Uint8Array(await image.arrayBuffer()));
}
const xlsx=await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(path.join(out,'Avatar_WS_Load_Test_2026-09-28.xlsx'));
console.log(JSON.stringify({workbook:path.join(out,'Avatar_WS_Load_Test_2026-09-28.xlsx'),measuredRows:raw.length,preflightRows:controlRows.length,scenarioRows:reports.length,verifiedTotals:totals}));
