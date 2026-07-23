#!/usr/bin/env python3
"""
pull_ls62.py — batch-pull LS62 election forms for the FY22-24 audit selections.

Reads selections.csv (fy,agency,name,period), finds each person's folder in
SharePoint via sp_access, downloads any file that looks like an LS62 / pay-rate
notice, and writes a summary CSV.

Run this on a machine on the trusted network (the Cowork sandbox IP is blocked
from the SharePoint /sites endpoints).

Usage:
  python3 pull_ls62.py --config "../../..//AHS-Compliance/.env"
  # or point --config at any .env with the SharePoint creds, e.g.:
  python3 pull_ls62.py --config "C:/Users/aaron/OneDrive/Stuff/Documents/GitHub/AHS-Compliance/.env"

Options:
  --config PATH       .env with SharePoint creds (required if not auto-found)
  --csv PATH          selections list (default: ./selections.csv)
  --out DIR           output dir (default: ./LS62_evidence)
  --threshold FLOAT   min folder-match confidence to auto-download (default 0.6)
"""
import argparse, csv, os, re, sys
import sp_access as s

LS62_PATTERNS = [
    r"ls\s*-?\s*0?62", r"pay\s*rate", r"rate\s*of\s*pay",
    r"notice\s*and\s*ack", r"wage\s*theft", r"195\.1", r"ls62",
]
LS62_RE = re.compile("|".join(LS62_PATTERNS), re.I)


def is_ls62(fname: str) -> bool:
    return bool(LS62_RE.search(fname))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config")
    ap.add_argument("--csv", default=os.path.join(os.path.dirname(__file__), "selections.csv"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "LS62_evidence"))
    ap.add_argument("--threshold", type=float, default=0.6)
    a = ap.parse_args()

    cfg = s.load_config(a.config)
    s.get_token(cfg)
    s.resolve_drive(cfg)

    with open(a.csv, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))

    seen, summary = set(), []
    for row in rows:
        name = row["name"].strip()
        agency = row.get("agency", "").strip()
        key = (agency, name.lower())
        if key in seen:
            continue
        seen.add(key)

        base, scored = s.find_folder(cfg, name)
        if not scored:
            summary.append([agency, name, "", "0", "NO FOLDERS UNDER BASE", ""])
            print(f"[--] {name}: no folders under base"); continue
        conf, folder = scored[0]
        if conf < a.threshold:
            close = "; ".join(f"{f['name']}({r:.2f})" for r, f in scored[:3])
            summary.append([agency, name, "", f"{conf:.2f}", "NO CONFIDENT MATCH", close])
            print(f"[??] {name}: best {folder['name']} {conf:.2f} (below {a.threshold})"); continue

        files = []
        s.walk_files(cfg, folder["path"], files)
        ls62 = [f for f in files if is_ls62(f["name"])]

        dest_dir = os.path.join(a.out, f"{agency}_{re.sub(r'[^\\w ]','_',name)}")
        got = []
        for f in ls62:
            drive = s.resolve_drive(cfg)
            import urllib.parse, urllib.request
            url = f"{s.GRAPH}/drives/{drive}/items/{f['id']}/content"
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + s.get_token(cfg)})
            os.makedirs(dest_dir, exist_ok=True)
            outp = os.path.join(dest_dir, f["name"])
            with urllib.request.urlopen(req, timeout=120) as r, open(outp, "wb") as w:
                w.write(r.read())
            got.append(f["name"])

        status = "LS62 DOWNLOADED" if got else ("NO LS62 IN FOLDER" if files else "FOLDER EMPTY")
        summary.append([agency, name, folder["name"], f"{conf:.2f}", status, "; ".join(got)])
        print(f"[{'OK' if got else '..'}] {name} -> {folder['name']} ({conf:.2f}) : {status} {got}")

    os.makedirs(a.out, exist_ok=True)
    sp = os.path.join(a.out, "ls62_pull_summary.csv")
    with open(sp, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["agency", "name", "matched_folder", "confidence", "status", "ls62_files_or_notes"])
        w.writerows(summary)
    n_ok = sum(1 for r in summary if r[4] == "LS62 DOWNLOADED")
    print(f"\nDone. {n_ok}/{len(summary)} had an LS62 downloaded. Summary: {sp}")


if __name__ == "__main__":
    main()
