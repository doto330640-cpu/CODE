#!/usr/bin/env python3
"""ECM 드론 분석 엑셀의 '일별날씨' 시트 → platform/data/weather.json  (코스별 일 기상, 센서보다 늦게까지 있음)
사용법:  python3 tools/build_weather_data.py <ECM 드론 분석 엑셀>
"""
import json, sys
import pandas as pd
RENAME = {"세종CC": "세종필드"}
ORDER = ["세종필드", "한맥CC", "장수CC", "벨라스톤CC", "김해상록CC"]

def n(v, d=2):
    return None if pd.isna(v) else round(float(v), d)

df = pd.read_excel(sys.argv[1], sheet_name="일별날씨")
df.columns = [str(c).replace("\n", "").replace(" ", "") for c in df.columns]
df["골프장"] = df["골프장"].replace(RENAME)
df["날짜"] = pd.to_datetime(df["날짜"]).dt.date.astype(str)
out = []
for name in ORDER:
    d = df[df["골프장"] == name].sort_values("날짜")
    out.append({"name": name, "daily": [{"date": r["날짜"], "tmax": n(r["최고기온(℃)"], 1), "tmin": n(r["최저기온(℃)"], 1), "tmean": n(r["평균기온(℃)"], 1),
        "hum": n(r["평균습도(%)"], 0), "rain": n(r["강수량(mm)"], 1), "wind": n(r["최대풍속(m/s)"], 1), "et0": n(r["증발산량ET0(mm)"]), "sky": None if pd.isna(r["날씨"]) else r["날씨"]} for _, r in d.iterrows()]})
json.dump({"source": "ECM 일별날씨(기상 예보·관측 연계). 센서 ATMOS 값과 출처가 다를 수 있음.", "courses": out}, open("platform/data/weather.json", "w"), ensure_ascii=False, separators=(",", ":"))
for c in out: print(c["name"], len(c["daily"]), c["daily"][0]["date"], "~", c["daily"][-1]["date"])
