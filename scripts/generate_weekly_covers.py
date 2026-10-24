from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
from pathlib import Path
import math

W,H=1200,1500
ROOT=Path("telegram/2026-10")
ROOT.mkdir(parents=True,exist_ok=True)
photo=Image.open(ROOT/"2026-10-24-evening-shopping-premium.jpg").convert("RGB")
BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
WHITE=(245,242,234);MUTED=(181,188,202);GOLD=(239,180,99)
subjects=[
("25","ВЫБОР",["4 ПРИЧИНЫ","ПОКУПАТЬ","ЛИШНЕЕ"],"Что запускает твою покупку?"),
("26","СКИДКИ",["СКИДКА 30% —","ЭТО НЕ ВСЕГДА","ЭКОНОМИЯ"],"Когда «выгода» становится тратой"),
("27","ПОДПИСКИ",["19 164 ₽","УХОДЯТ","НЕЗАМЕТНО"],"Три подписки. Один год. Реальный расчёт."),
("28","СОН И ДЕНЬГИ",["НЕДОСЫП","МЕНЯЕТ","РЕШЕНИЯ?"],"Мифы и факты без преувеличений"),
("29","ПОВЕДЕНИЕ",["ОДИН КЛИК.","ОДНА","ПОКУПКА."],"Как сделать паузу перед оплатой"),
("30","ЛОВУШКИ",["УЖЕ","ПОТРАТИЛ?","ОСТАНОВИСЬ"],"Почему прошлые затраты — плохой советчик"),
("31","ЭКСПЕРИМЕНТ",["7 ДНЕЙ.","ОДНА","ПРИВЫЧКА."],"Небольшие шаги к денежной ясности")
]
def font(path,size):return ImageFont.truetype(path,size)
for idx,(day,section,headline,subtitle) in enumerate(subjects):
    crop=photo.crop((0,365,photo.width,photo.height))
    factor=max(W/crop.width,950/crop.height)
    crop=crop.resize((math.ceil(crop.width*factor),math.ceil(crop.height*factor)),Image.Resampling.LANCZOS)
    cx=int(max(0,crop.width-W)*[.10,.66,.32,.52,.24,.58,.40][idx])
    crop=crop.crop((cx,0,cx+W,950))
    if idx in [2,4,6]:crop=crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    crop=ImageEnhance.Color(crop).enhance([.75,1.05,.92,.85,1,.77,.93][idx])
    base=Image.new("RGBA",(W,H),(6,13,24,255))
    base.alpha_composite(crop.convert("RGBA"),(0,540))
    cover=Image.new("RGBA",(W,H),(0,0,0,0));d=ImageDraw.Draw(cover)
    d.rectangle((0,0,W,530),fill=(6,13,24,255))
    for yy in range(530,870):
        d.line((0,yy,W,yy),fill=(6,13,24,int(235*(870-yy)/340)))
    for yy in range(1180,H):
        d.line((0,yy,W,yy),fill=(3,11,22,int(160*(yy-1180)/(H-1180))))
    base=Image.alpha_composite(base,cover)
    draw=ImageDraw.Draw(base)
    draw.line([(76,94),(260,94)],fill=GOLD,width=3)
    draw.line([(950,94),(1124,94)],fill=GOLD,width=3)
    draw.text((300,78),"MONEY PSYCHOLOGY  |  NO BS",font=font(BOLD,25),fill=WHITE)
    draw.text((77,160),"#"+section,font=font(BOLD,26),fill=GOLD)
    draw.text((1120,156),day+".10.2026",font=font(REG,24),anchor="ra",fill=MUTED)
    top=228
    for row in headline:
        size=80
        while size>43 and draw.textbbox((0,0),row,font=font(BOLD,size))[2]>1070:
            size-=2
        draw.text((74,top),row,font=font(BOLD,size),fill=GOLD if row==headline[-1] else WHITE)
        top+=int(size*1.30)
    draw.line([(79,top+17),(630,top+17)],fill=GOLD,width=3)
    if idx==1:
        draw.rounded_rectangle((730,905,1075,1052),radius=24,fill=(37,29,27,220),outline=GOLD,width=3)
        draw.text((902,940),"−30%",font=font(BOLD,76),anchor="mt",fill=GOLD)
    if idx==2:
        draw.rounded_rectangle((716,916,1105,1040),radius=21,fill=(22,34,44,220),outline=GOLD,width=2)
        draw.text((740,932),"299 + 499 + 799",font=font(BOLD,26),fill=GOLD)
        draw.text((743,980),"= 1 597 ₽ / мес.",font=font(BOLD,28),fill=WHITE)
    draw.rounded_rectangle((66,1284,1134,1434),radius=23,fill=(4,14,25,226),outline=GOLD,width=2)
    sf=font(REG,25)
    while draw.textbbox((0,0),subtitle,font=sf)[2]>990 and sf.size>18:sf=font(REG,sf.size-1)
    draw.text((92,1320),subtitle,font=sf,fill=WHITE)
    draw.text((93,1382),"@psy_money1  •  МЫСЛИ О ДЕНЬГАХ БЕЗ ВОДЫ",font=font(REG,18),fill=MUTED)
    draw.text((1105,1382),f"{idx+1:02d}/07",font=font(BOLD,19),anchor="ra",fill=GOLD)
    dest=ROOT/f"2026-10-{day}-cover.jpg"
    base.convert("RGB").resize((900,1125),Image.Resampling.LANCZOS).save(dest,quality=83,optimize=True,progressive=True)
    with Image.open(dest) as check:check.verify()
    print(dest,dest.stat().st_size)
