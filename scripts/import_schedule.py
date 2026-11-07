"""Extract color-coded half-hour activities without changing the source workbook."""
import colorsys
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
import openpyxl
from openpyxl.styles.colors import COLOR_INDEX

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'schedule.xlsx'
book = openpyxl.load_workbook(SOURCE, data_only=True)
sheet = book['schedule']
theme = ET.fromstring(book.loaded_theme)
scheme = theme.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}clrScheme')
theme_names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
theme_colors = {}
for element in scheme:
    child = list(element)[0]
    theme_colors[element.tag.split('}')[-1]] = child.get('lastClr') or child.get('val')

def fill_key(cell):
    fill = cell.fill
    return (fill.patternType, fill.fgColor.type, str(fill.fgColor.value), fill.fgColor.tint) if fill.patternType else ('none',)

def rgb(cell):
    color = cell.fill.fgColor
    if not cell.fill.patternType:
        return '#edf1ee'
    if color.type == 'rgb':
        value = color.rgb[-6:]
    elif color.type == 'theme':
        value = theme_colors[theme_names[color.theme]]
    elif color.type == 'indexed':
        value = COLOR_INDEX[color.indexed][-6:]
    else:
        raise ValueError(f'Unsupported color at {cell.coordinate}')
    channels = [int(value[i:i+2], 16) / 255 for i in (0, 2, 4)]
    if color.tint:
        hue, lum, sat = colorsys.rgb_to_hls(*channels)
        lum = lum * (1 + color.tint) if color.tint < 0 else lum * (1 - color.tint) + color.tint
        channels = colorsys.hls_to_rgb(hue, lum, sat)
    return '#' + ''.join(f'{round(channel * 255):02x}' for channel in channels)

activities = []
legend = {}
for row in range(43, 51):
    label = sheet.cell(row, 4).value
    if not label:
        continue
    activity = {'id': f'a{len(activities)}', 'label': label, 'color': rgb(sheet.cell(row, 3))}
    assert fill_key(sheet.cell(row, 3)) not in legend, 'Ambiguous legend color'
    legend[fill_key(sheet.cell(row, 3))] = activity['id']
    activities.append(activity)

days = []
for col in range(3, sheet.max_column + 1, 2):
    header = sheet.cell(2, col - 1).value
    if not header:
        continue
    match = re.match(r'(\d{4})\.(\d{2})\.(\d{2})\.', str(header))
    if not match:
        raise ValueError(f'Invalid date at {sheet.cell(2, col - 1).coordinate}')
    date = datetime(*map(int, match.groups())).date().isoformat()
    segments = [{'start': 0, 'end': 360, 'activity': None}]
    for row in range(3, 39):
        start = 360 + (row - 3) * 30
        # Each hour label spans exactly two half-hour cells; midnight is the endpoint.
        anchor_row = row if row % 2 else row - 1
        assert int(sheet.cell(anchor_row, col - 1).value) == start // 60
        color = fill_key(sheet.cell(row, col))
        if color not in legend:
            raise ValueError(f'No legend entry for {sheet.cell(row, col).coordinate}')
        activity = legend[color]
        if segments[-1]['activity'] == activity and segments[-1]['end'] == start:
            segments[-1]['end'] = start + 30
        else:
            segments.append({'start': start, 'end': start + 30, 'activity': activity})
    days.append({'date': date, 'segments': segments})

days.sort(key=lambda day: day['date'])
assert len({day['date'] for day in days}) == len(days)
data = {'sourceFile': SOURCE.name, 'precisionMinutes': 30, 'activities': activities, 'days': days}
target = ROOT / 'dist' / 'data-schedule.js'
target.write_text('/* Recalled schedule extracted from the workbook legend and half-hour cells. */\nwindow.PERSONAL_SCHEDULE = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
book.close()
print(json.dumps({'scheduleDays': len(days), 'activities': len(activities), 'segments': sum(len(day['segments']) for day in days)}))
