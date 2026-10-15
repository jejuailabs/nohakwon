from pathlib import Path
import os
from PIL import Image,ImageDraw,ImageFont
p=Path('.local/cover-verification')
p.mkdir(parents=True,exist_ok=True)
font=os.environ.get('TEXTBOOK_TEST_FONT','C:/Windows/Fonts/malgun.ttf')
def render(filename,rows):
 image=Image.new('RGB',(1800,340+len(rows)*150),'white');draw=ImageDraw.Draw(image)
 draw.text((70,45),'중학교 1학년 교과서 안내 · 2022 개정',font=ImageFont.truetype(font,52),fill='#14203b')
 draw.text((70,125),'인식 검증용 합성 안내표 — 실제 학교 안내문이 아닙니다',font=ImageFont.truetype(font,29),fill='#536078')
 cols=[70,340,720,1190]
 for x,t in zip(cols,['과목 / 권','출판사','대표 저자','교육과정']):draw.text((x,230),t,font=ImageFont.truetype(font,34),fill='#334155')
 for n,row in enumerate(rows):
  y=310+n*150;draw.line((60,y-15,1740,y-15),fill='#cbd5e1',width=2)
  for x,t in zip(cols,row):draw.text((x,y+20),t,font=ImageFont.truetype(font,39),fill='#111827')
 image.save(p/filename)
rows=[['국어 1-1','미래엔','신유식','2022 개정'],['영어 1','동아출판','윤정미','2022 개정'],['수학 1','천재교과서','김화경','2022 개정'],['사회 ①','비상교육','강창숙','2022 개정'],['과학 1','지학사','홍훈기','2022 개정']]
render('middle1-five-subjects.png',rows)
render('middle1-single-subject.png',[rows[2]])
print('Created synthetic five-subject table and single-subject table')
