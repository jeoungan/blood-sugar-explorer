"""Reproduce the report's descriptive statistics and figures from the measured workbook.

Usage: python analysis/report_analysis.py --input path/to/Blood_Sugar_level_data.xlsx --output report-data
Requires openpyxl and matplotlib. No photographs are read or exported.
"""
import argparse
import json
import statistics
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
import openpyxl
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib import font_manager

def read_records(path):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook['Sheet1']
    records = []
    for index, row in enumerate(sheet.iter_rows(min_row=3, values_only=True), 3):
        _, date, clock, value, site, note, detail, *extra = row
        if date is None and value is None:
            continue
        stamp = datetime.combine(date.date(), clock)
        records.append(dict(row=index, date=stamp.date().isoformat(), time=stamp.strftime('%H:%M'),
                            minute=clock.hour*60+clock.minute, value=value,
                            note=note or '', detail=detail or '', extra=(extra[0] if extra else '') or ''))
    workbook.close()
    records.sort(key=lambda record: (record['date'], record['minute']))
    assert len({(r['date'],r['time']) for r in records}) == len(records), 'Duplicate timestamp'
    return records

def calculate(records):
    values = [record['value'] for record in records]
    summary = dict(n=len(values), dates=len({r['date'] for r in records}),
                   mean=statistics.mean(values), sd=statistics.stdev(values), median=statistics.median(values),
                   min=min(values), max=max(values), per_day=dict(Counter(r['date'] for r in records)))
    dinner = []
    for date in ['2026-11-03','2026-11-05','2026-11-06']:
        sample=[r for r in records if r['date']==date and r['minute']>=1080]
        baseline=next(r for r in sample if r['minute']==1080)
        highest=max((r for r in sample if r['minute']<=1230),key=lambda r:r['value'])
        two=next(r for r in sample if r['minute']==1215)
        four=next(r for r in sample if r['minute']==1335)
        dinner.append(dict(date=date, pre=baseline['value'], observed_peak=highest['value'],
                           peak_time=highest['time'], change=highest['value']-baseline['value'],
                           approx_2h=two['value'], approx_4h=four['value']))
    return dict(summary=summary,dinner=dinner,records=records)

def segments(records):
    current=[]
    for record in records:
        if current and record['minute']-current[-1]['minute']>120:
            yield current
            current=[]
        current.append(record)
    if current:
        yield current

def configure_style():
    malgun=Path('C:/Windows/Fonts/malgun.ttf')
    if malgun.exists():
        font_manager.fontManager.addfont(str(malgun))
        font=font_manager.FontProperties(fname=str(malgun)).get_name()
    else:
        candidates=['Noto Sans CJK KR','NanumGothic','Noto Sans CJK JP','DejaVu Sans']
        available={item.name for item in font_manager.fontManager.ttflist}
        font=next((name for name in candidates if name in available),'DejaVu Sans')
    plt.rcParams.update({'font.family':font,'font.size':9,'axes.unicode_minus':False,
                         'axes.spines.top':False,'axes.spines.right':False,
                         'axes.labelcolor':'#243e3f','text.color':'#243e3f',
                         'xtick.color':'#3e5251','ytick.color':'#3e5251','savefig.facecolor':'white'})

def draw(data, output):
    configure_style()
    records=data['records']
    fig,ax=plt.subplots(figsize=(7.0,2.25),layout='constrained')
    for date in dict.fromkeys(r['date'] for r in records):
        daily=[r for r in records if r['date']==date]
        for segment in segments(daily):
            xs=[datetime.fromisoformat(r['date']+'T'+r['time']) for r in segment]
            ax.plot(xs,[r['value'] for r in segment],color='#087b7e',lw=.7,ls=(0,(2,3)),alpha=.3)
    timestamps=[datetime.fromisoformat(r['date']+'T'+r['time']) for r in records]
    ax.scatter(timestamps,[r['value'] for r in records],s=11,color='#087b7e',zorder=3)
    peak=max(records,key=lambda r:r['value'])
    stamp=datetime.fromisoformat(peak['date']+'T'+peak['time'])
    ax.scatter([stamp],[peak['value']],s=25,color='#bd7900',zorder=4)
    ax.annotate('최고 266',xy=(stamp,peak['value']),xytext=(-18,9),textcoords='offset points',fontsize=8)
    ax.set_ylim(50,290);ax.set_ylabel('혈당 (mg/dL)')
    ax.xaxis.set_major_locator(mdates.DayLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
    ax.tick_params(axis='x',labelsize=7.5)
    ax.grid(axis='y',color='#dfe7e2',lw=.6);ax.set_axisbelow(True)
    fig.savefig(output/'overview.png',dpi=260);plt.close(fig)

    fig,ax=plt.subplots(figsize=(7.0,2.45),layout='constrained')
    settings=[('2026-11-03','11/3 피자·스파게티·콜라','#087b7e'),
              ('2026-11-05','11/5 쿠키·사이다·과자','#c87c12'),
              ('2026-11-06','11/6 계란·닭가슴살','#5542a0')]
    for date,label,color in settings:
        sample=[r for r in records if r['date']==date and r['minute']>=1080]
        for segment in segments(sample):
            ax.plot([r['minute']/60 for r in segment],[r['value'] for r in segment],color=color,lw=1,ls=(0,(3,3)),alpha=.55)
        ax.scatter([r['minute']/60 for r in sample],[r['value'] for r in sample],s=23,color=color,label=label,zorder=3)
    ax.set_xlim(17.9,22.5);ax.set_ylim(80,285)
    ax.set_xticks([18,19,20,21,22],['18:00','19:00','20:00','21:00','22:00'])
    ax.set_xlabel('실제 측정 시각');ax.set_ylabel('혈당 (mg/dL)')
    ax.grid(axis='y',color='#dfe7e2',lw=.6);ax.set_axisbelow(True)
    ax.legend(loc='upper right',frameon=False,fontsize=8)
    fig.savefig(output/'dinner.png',dpi=260);plt.close(fig)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path('report-data'))
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    data=calculate(read_records(args.input))
    (args.output/'results.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    draw(data,args.output)
    print(json.dumps({'summary':data['summary'],'dinner':data['dinner']},ensure_ascii=False))

if __name__=='__main__':
    main()
