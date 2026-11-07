"""Read the original workbook without modifying it; rebuild the static personal data."""
import csv
import json
import sys
from pathlib import Path
from datetime import datetime
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'Blood_Sugar_level_data.xlsx'
OUT = ROOT / 'dist'
workbook = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
sheet = workbook['Sheet1']
records = []
for row_number, cells in enumerate(sheet.iter_rows(min_row=3, values_only=True), start=3):
    _, date, time, value, site, note, detail, *extra = cells
    if date is None and value is None:
        continue
    if not isinstance(date, datetime) or not isinstance(value, (int, float)):
        raise ValueError(f'Invalid record at row {row_number}')
    record = dict(id=f'r{row_number}', date=date.date().isoformat(), time=time.strftime('%H:%M'),
                  minute=time.hour * 60 + time.minute, value=value, note=note or '',
                  detail=detail or '', extra=(extra[0] if extra else '') or '', site=site or '')
    records.append(record)
records.sort(key=lambda r: (r['date'], r['minute']))
assert len({(r['date'], r['minute']) for r in records}) == len(records), 'Duplicate measurement times'
first = datetime.fromisoformat(records[0]['date']).date()
last = datetime.fromisoformat(records[-1]['date']).date()
days = (last - first).days + 1
dates = sorted({r['date'] for r in records})
for record in records:
    date = datetime.fromisoformat(record['date']).date()
    record['day'] = (date - first).days + 1
    record['photo'] = ''  # Public edition never exports photographs.
data = dict(label='내 혈당 기록', source='personal', sourceFile=SOURCE.name,
            days=days, dates=dates, startDate=first.isoformat(), endDate=last.isoformat(),
            maxGap=120, records=records,
            points=[[r['day'], r['minute'], r['value']] for r in records])
(OUT / 'data-personal.js').write_text('/* Original measured values; no synthetic data or interpolation. */\nwindow.PERSONAL_DATA = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
with (OUT / 'blood-sugar-records.csv').open('w', encoding='utf-8-sig', newline='') as handle:
    writer = csv.writer(handle)
    writer.writerow(['날짜', '시간', '혈당(mg/dL)', '측정 상황', '생활 메모', '추가 메모'])
    writer.writerows([r['date'], r['time'], r['value'], r['note'], r['detail'], r['extra']] for r in records)
workbook.close()
print(json.dumps(dict(records=len(records), days=days, photos=sum(bool(r['photo']) for r in records), min=min(r['value'] for r in records), max=max(r['value'] for r in records))))
