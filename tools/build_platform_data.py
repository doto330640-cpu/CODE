#!/usr/bin/env python3
"""골프장별 센서 엑셀(ATMOS 41 기상 + TEROS 12 토양) → platform/data/courses.json

사용법:  python3 tools/build_platform_data.py <엑셀 폴더>
파일 이름의 앞부분이 아니라 시트 이름·컬럼으로 코스를 구분하므로, 아래 SOURCES의 키워드(파일 안내 문구)만 맞으면 된다.
부분일(측정 건수 90건 미만)의 증발산량은 신뢰할 수 없어 비운다.
"""
import json, sys, glob, datetime as dt
import pandas as pd

OUT = "platform/data/courses.json"


def day(v):
    if isinstance(v, (int, float)) and not pd.isna(v) and v > 40000:
        return (dt.date(1899, 12, 30) + dt.timedelta(days=int(v))).isoformat()
    try:
        return pd.to_datetime(v).date().isoformat()
    except Exception:
        return None


def num(v):
    try:
        f = float(v)
        return None if pd.isna(f) else round(f, 3)
    except Exception:
        return None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 3) if xs else None


def sheet(path, name, header=0):
    return pd.read_excel(path, sheet_name=name, header=header)


def col(df, *keys):
    """컬럼명에 keys가 모두 들어간 첫 컬럼 (줄바꿈·공백 무시)"""
    for c in df.columns:
        s = str(c).replace("\n", "").replace(" ", "")
        if all(k.replace(" ", "") in s for k in keys):
            return c
    raise KeyError((keys, list(df.columns)))


def rows_from(df, datecol, fields):
    out = {}
    for _, r in df.iterrows():
        d = day(r[datecol])
        if not d or not d.startswith("2026"):
            continue
        out[d] = {k: fn(r) for k, fn in fields.items()}
    return out


def merge(w, s, partial_before=None):
    days = sorted(set(w) | set(s))
    res = []
    for d in days:
        a, b = w.get(d, {}), s.get(d, {})
        ports = b.get("ports", [None, None, None])
        res.append({
            "date": d,
            "tmean": a.get("tmean"), "tmax": a.get("tmax"), "tmin": a.get("tmin"),
            "rain": a.get("rain"), "et0": a.get("et0"),
            "vwc": mean(ports), "ports": ports,
            "soilT": b.get("soilT"), "ec": b.get("ec"),
        })
    return res


def courses(folder):
    files = glob.glob(folder + "/*.xlsx")
    by = {}
    for f in files:
        names = pd.ExcelFile(f).sheet_names
        if "증발산_강수_비교" in names: by["김해상록CC"] = f
        elif "로거상태" in names: by["벨라스톤CC"] = f
        elif "일별 데이터" in names: by["장수CC"] = f
        elif "가정" in names: by["세종필드"] = f
        elif "일별_기상" in names: by["한맥CC"] = f
    return by


def build(folder):
    by = courses(folder)
    res = {}

    # 세종필드 — 일별_기상 / 일별_토양 (날짜가 엑셀 일련번호)
    f = by["세종필드"]
    W, S = sheet(f, "일별_기상"), sheet(f, "일별_토양")
    w = rows_from(W, W.columns[0], {
        "tmean": lambda r: num(r[col(W, "평균기온")]), "tmax": lambda r: num(r[col(W, "최고기온")]),
        "tmin": lambda r: num(r[col(W, "최저기온")]), "rain": lambda r: num(r[col(W, "강수량")]),
        "et0": lambda r: num(r[col(W, "ET0")]) if (num(r[col(W, "관측건수")]) or 0) >= 90 else None})
    s = rows_from(S, S.columns[0], {
        "ports": lambda r: [num(r[col(S, f"Port{i}", "수분")]) for i in (1, 2, 3)],
        "soilT": lambda r: num(r[col(S, "평균", "토양온도")]),
        "ec": lambda r: mean([num(r[col(S, f"Port{i}", "EC")]) for i in (1, 2, 3)])})
    res["세종필드"] = merge(w, s)

    # 한맥CC
    f = by["한맥CC"]
    W, S = sheet(f, "일별_기상"), sheet(f, "일별_토양")
    w = rows_from(W, W.columns[0], {
        "tmean": lambda r: num(r[col(W, "평균기온")]), "tmax": lambda r: num(r[col(W, "최고기온")]),
        "tmin": lambda r: num(r[col(W, "최저기온")]), "rain": lambda r: num(r[col(W, "강수량")]),
        "et0": lambda r: num(r[col(W, "ET0")])})
    s = rows_from(S, S.columns[0], {
        "ports": lambda r: [num(r[col(S, f"Port{i}", "수분")]) for i in (1, 2, 3)],
        "soilT": lambda r: mean([num(r[col(S, f"Port{i}", "온도")]) for i in (1, 2, 3)]),
        "ec": lambda r: mean([num(r[col(S, f"Port{i}", "EC")]) for i in (1, 2, 3)])})
    res["한맥CC"] = merge(w, s)

    # 장수CC — 한 시트
    f = by["장수CC"]
    D = sheet(f, "일별 데이터")
    cnt = col(D, "측정수")
    both = rows_from(D, D.columns[0], {
        "tmean": lambda r: num(r[col(D, "평균기온")]), "tmax": lambda r: num(r[col(D, "최고기온")]),
        "tmin": lambda r: num(r[col(D, "최저기온")]), "rain": lambda r: num(r[col(D, "일강수량")]),
        "et0": lambda r: num(r[col(D, "ET0")]) if (num(r[cnt]) or 0) >= 90 else None,
        "ports": lambda r: [num(r[col(D, f"토양수분Port{i}")]) for i in (1, 2, 3)],
        "soilT": lambda r: mean([num(r[col(D, f"토양온도Port{i}")]) for i in (1, 2, 3)]),
        "ec": lambda r: mean([num(r[col(D, f"토양EC Port{i}")]) for i in (1, 2, 3)])})
    res["장수CC"] = merge(both, both)

    # 벨라스톤CC — 기상데이터 / 토양센서 / 증발산량(헤더 7행)
    f = by["벨라스톤CC"]
    W, S = sheet(f, "기상데이터"), sheet(f, "토양센서")
    E = sheet(f, "증발산량", header=6)
    et = {day(r[E.columns[0]]): num(r[E.columns[1]]) for _, r in E.iterrows() if day(r[E.columns[0]])}
    cntw = col(W, "측정건수")
    w = rows_from(W, W.columns[0], {
        "tmean": lambda r: num(r[col(W, "기온일평균")]), "tmax": lambda r: num(r[col(W, "최고기온")]),
        "tmin": lambda r: num(r[col(W, "최저기온")]), "rain": lambda r: num(r[col(W, "강수량일합계")]),
        "et0": lambda r: None})
    for d in w:
        n = num(W.loc[W[W.columns[0]].map(day) == d, cntw].iloc[0]) or 0
        w[d]["et0"] = et.get(d) if n >= 90 else None
    s = rows_from(S, S.columns[0], {
        "ports": lambda r: [num(r[col(S, f"포트{i}", "토양수분")]) for i in (1, 2, 3)],
        "soilT": lambda r: mean([num(r[col(S, f"포트{i}", "토양온도")]) for i in (1, 2, 3)]),
        "ec": lambda r: mean([num(r[col(S, f"포트{i}", "EC")]) for i in (1, 2, 3)])})
    res["벨라스톤CC"] = merge(w, s)

    # 김해상록CC — 기상_일별 / 토양수분_일별 (부분일 제외)
    f = by["김해상록CC"]
    W, S = sheet(f, "기상_일별"), sheet(f, "토양수분_일별")
    cw, cs = col(W, "측정건수"), col(S, "측정건수")
    w = rows_from(W, W.columns[0], {
        "tmean": lambda r: num(r[col(W, "평균기온")]), "tmax": lambda r: num(r[col(W, "최고기온")]),
        "tmin": lambda r: num(r[col(W, "최저기온")]), "rain": lambda r: num(r[col(W, "강수량")]),
        "et0": lambda r: num(r[col(W, "ETo")]) if (num(r[cw]) or 0) >= 90 else None,
        "_n": lambda r: num(r[cw])})
    w = {d: v for d, v in w.items() if (v["_n"] or 0) >= 90}
    s = rows_from(S, S.columns[0], {
        "ports": lambda r: [num(r[col(S, f"Port{i}", "수분함량평균")]) for i in (1, 2, 3)],
        "soilT": lambda r: mean([num(r[col(S, f"Port{i}", "지온평균")]) for i in (1, 2, 3)]),
        "ec": lambda r: mean([num(r[col(S, f"Port{i}", "EC평균")]) for i in (1, 2, 3)]),
        "_n": lambda r: num(r[cs])})
    s = {d: v for d, v in s.items() if (v["_n"] or 0) >= 90}
    res["김해상록CC"] = merge(w, s)

    return res


if __name__ == "__main__":
    data = build(sys.argv[1])
    names = ["세종필드", "한맥CC", "장수CC", "벨라스톤CC", "김해상록CC"]
    out = {"generated": dt.date.today().isoformat(),
           "source": "ATMOS 41 기상 + TEROS 12 토양 센서(15분 간격) 일별 집계. 증발산량은 FAO-56 Penman-Monteith 계산값(Kc 미적용).",
           "courses": [{"name": n, "daily": data[n]} for n in names]}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    for c in out["courses"]:
        d = c["daily"]
        print(c["name"], len(d), d[0]["date"], "~", d[-1]["date"],
              "| 토양 마지막", next((x["date"] for x in reversed(d) if x["vwc"] is not None), None))
