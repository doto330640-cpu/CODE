#!/usr/bin/env python3
"""ECM 드론 분석 원데이터 엑셀 → platform/data/drone.json

사용법:  python3 tools/build_drone_data.py <ECM 드론 분석 엑셀 파일>
- 코스_일자별 : 촬영일별 코스 평균(TSI·식생지수·양분·병해 위험) → trend
- 홀구역_일자별: 홀·구역(그린/티박스/페어웨이)별 값 → holes (첫 촬영, 마지막 촬영, 변화)
드론 파일의 코스명(세종CC)을 센서 파일의 코스명(세종필드)에 맞춘다.
열화상 원시값(엽온 60℃ 초과)은 쓰지 않는다(이 스크립트는 열화상 지표를 내보내지 않음).
"""
import json, sys
import pandas as pd

OUT = "platform/data/drone.json"
RENAME = {"세종CC": "세종필드"}
ORDER = ["세종필드", "한맥CC", "장수CC", "벨라스톤CC", "김해상록CC"]
PEST = {"DSI": "달러스팟", "PBI": "피시움 블라이트", "BPI": "브라운패치", "FRI": "퓨사리움", "RRI": "녹병",
        "GRI": "굼벵이", "SBI": "설부병", "LPI": "라지패치", "ANT": "탄저병", "SPI": "여름패치"}


def clean(df):
    df.columns = [str(c).replace("\n", "").replace(" ", "") for c in df.columns]
    df["골프장"] = df["골프장"].replace(RENAME)
    df["촬영일"] = pd.to_datetime(df["촬영일"]).dt.date.astype(str)
    return df


def f(v, n=3):
    return None if pd.isna(v) else round(float(v), n)


def pest_of(row, suffix):
    out = {}
    for k in PEST:
        for c in row.index:
            if f"({k})" in c and c.endswith(suffix):
                v = f(row[c], 1)
                if v is not None:
                    out[k] = v
    return out


def main(path):
    cd = clean(pd.read_excel(path, sheet_name="코스_일자별"))
    hz = clean(pd.read_excel(path, sheet_name="홀구역_일자별"))
    res = []
    for name in ORDER:
        c = cd[cd["골프장"] == name].sort_values("촬영일")
        trend = []
        for _, r in c.iterrows():
            trend.append({
                "date": r["촬영일"], "grade": r["TSI등급"], "tsi": f(r["TSI종합상태(0~100)"], 1),
                "ndvi": f(r["식생지수(NDVI)평균"]), "ndviLow": f(r["식생지수낮은면적%"], 1),
                "ndre": f(r["양분(NDRE)평균"]), "ndreLow": f(r["양분낮은면적%"], 1),
                "risk": pest_of(r, "위험"), "ref": "엽록소밴드없음" in str(r.get("비고", "")).replace(" ", "")})
        h = hz[hz["골프장"] == name]
        first, last = h["촬영일"].min(), h["촬영일"].max()
        holes = {}
        for _, r in h[h["촬영일"].isin([first, last])].iterrows():
            e = holes.setdefault(int(r["홀번호"]), {"hole": int(r["홀번호"]), "name": r["홀이름"], "par": f(r["파"], 0), "nine": r["코스(나인)"], "zones": {}})
            z = e["zones"].setdefault(r["구역"], {})
            tag = "last" if r["촬영일"] == last else "first"
            z[tag] = {"ndvi": f(r["식생지수(NDVI)"]), "ndre": f(r["양분(NDRE)"]), "lowPct": f(r["식생지수낮은면적%"], 1), "risk": pest_of(r, "")}
            if tag == "last":
                e["tsi"] = f(r["홀TSI(홀전체)"], 1); e["grade"] = r["홀TSI등급"]
        for e in holes.values():
            for z in e["zones"].values():
                a, b = z.get("first", {}).get("ndvi"), z.get("last", {}).get("ndvi")
                z["change"] = None if a is None or b is None else round(b - a, 3)
        res.append({"name": name, "first": first, "last": last, "trend": trend, "holes": [holes[k] for k in sorted(holes)]})
    out = {"source": "ECM 드론 분석(촬영일별). TSI 종합 상태 0~100, 식생지수 NDVI, 양분 NDRE. 병해 위험 0~100.",
           "pests": PEST, "courses": res}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    for c in res:
        t = c["trend"][-1]
        print(c["name"], len(c["trend"]), "회", c["first"], "~", c["last"], "| 홀", len(c["holes"]), "| 마지막 TSI", t["tsi"], t["grade"], "NDVI", t["ndvi"])


if __name__ == "__main__":
    main(sys.argv[1])
