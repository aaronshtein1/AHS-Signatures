#!/usr/bin/env python3
"""
sp_access.py — local Microsoft Graph / SharePoint access script (app-only).

Mirrors the auth path in AHS-Signatures/backend/src/services/sharepoint.service.ts:
client-credentials token -> resolve drive -> navigate the document library.

Credentials are read from a .env file (never passed on the command line).
Auto-discovery order for the config file:
  1. --config <path>
  2. $SP_CONFIG
  3. ./.env  (current dir)
  4. <script_dir>/../assets/sharepoint_config.env
Real environment variables always override file values.

Env keys (same names as the TS service):
  MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET   (required)
  One drive locator, in priority order:
    SHAREPOINT_DRIVE_ID                                (fastest, no extra calls)
    SHAREPOINT_SITE_ID   + SHAREPOINT_LIBRARY_NAME     (list drives, match name)
    SHAREPOINT_SITE_URL  + SHAREPOINT_LIBRARY_NAME     (resolve site, then drive)
  SHAREPOINT_BASE_FOLDER   (default "Signed Documents") — where per-person folders live
  SHAREPOINT_LIBRARY_NAME  (default "Documents")

Commands:
  test                                  verify auth + drive + base folder
  list-folders [--subfolder S]          list person folders under BASE_FOLDER
  find "<name>" [--subfolder S]         fuzzy-match a person folder
  ls "<drive/path>"                     list children at a path (files + folders)
  tree "<name>" [--subfolder S]         list all files in a matched person folder (recursive)
  search "<query>"                      drive-wide search
  download "<drive/path>" <dest>        download a file
  download-id <itemId> <dest>           download a file by item id

All output is JSON on stdout.
"""
import argparse, json, os, sys, urllib.parse, urllib.request, urllib.error, difflib, re

GRAPH = "https://graph.microsoft.com/v1.0"


def load_config(explicit=None):
    candidates = []
    if explicit:
        candidates.append(explicit)
    if os.environ.get("SP_CONFIG"):
        candidates.append(os.environ["SP_CONFIG"])
    candidates.append(os.path.join(os.getcwd(), ".env"))
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "..", "assets", "sharepoint_config.env"))
    cfg = {}
    for path in candidates:
        if path and os.path.isfile(path):
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    v = v.strip().strip('"').strip("'")
                    cfg.setdefault(k.strip(), v)
            break
    # real env overrides file
    for k in list(cfg.keys()) + [
        "MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET",
        "SHAREPOINT_TENANT_ID", "SHAREPOINT_CLIENT_ID", "SHAREPOINT_CLIENT_SECRET",
        "SHAREPOINT_DRIVE_ID", "SHAREPOINT_SITE_ID", "SHAREPOINT_SITE_URL",
        "SHAREPOINT_LIBRARY_NAME", "SHAREPOINT_BASE_FOLDER", "SHAREPOINT_FOLDER_PATH",
    ]:
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    # Accept either MICROSOFT_* or SHAREPOINT_* credential key names
    for a, b in (("MICROSOFT_TENANT_ID", "SHAREPOINT_TENANT_ID"),
                 ("MICROSOFT_CLIENT_ID", "SHAREPOINT_CLIENT_ID"),
                 ("MICROSOFT_CLIENT_SECRET", "SHAREPOINT_CLIENT_SECRET")):
        if not cfg.get(a) and cfg.get(b):
            cfg[a] = cfg[b]
    cfg.setdefault("SHAREPOINT_LIBRARY_NAME", "Documents")
    # BASE_FOLDER: explicit wins, else SHAREPOINT_FOLDER_PATH, else default
    if not cfg.get("SHAREPOINT_BASE_FOLDER"):
        cfg["SHAREPOINT_BASE_FOLDER"] = cfg.get("SHAREPOINT_FOLDER_PATH") or "Signed Documents"
    return cfg


def die(msg, code=1):
    print(json.dumps({"ok": False, "error": str(msg)}, indent=2))
    sys.exit(code)


_token = {"val": None}


def get_token(cfg):
    if _token["val"]:
        return _token["val"]
    for req in ("MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"):
        if not cfg.get(req):
            die(f"Missing required config: {req}")
    url = f"https://login.microsoftonline.com/{cfg['MICROSOFT_TENANT_ID']}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "client_id": cfg["MICROSOFT_CLIENT_ID"],
        "client_secret": cfg["MICROSOFT_CLIENT_SECRET"],
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode()
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            _token["val"] = json.loads(r.read())["access_token"]
    except urllib.error.HTTPError as e:
        die(f"Token request failed ({e.code}): {e.read().decode(errors='ignore')}")
    except Exception as e:
        die(f"Token request error: {e}")
    return _token["val"]


def graph(cfg, method, path, raw=False):
    url = path if path.startswith("http") else GRAPH + path
    req = urllib.request.Request(url, method=method,
                                 headers={"Authorization": f"Bearer {get_token(cfg)}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return body if raw else json.loads(body or b"{}")
    except urllib.error.HTTPError as e:
        die(f"Graph {method} {url} failed ({e.code}): {e.read().decode(errors='ignore')}")
    except Exception as e:
        die(f"Graph {method} {url} error: {e}")


_drive = {"id": None}


def resolve_drive(cfg):
    if _drive["id"]:
        return _drive["id"]
    if cfg.get("SHAREPOINT_DRIVE_ID"):
        _drive["id"] = cfg["SHAREPOINT_DRIVE_ID"]
        return _drive["id"]
    # need a site id
    site_id = cfg.get("SHAREPOINT_SITE_ID")
    if not site_id:
        surl = cfg.get("SHAREPOINT_SITE_URL")
        if not surl:
            die("Set SHAREPOINT_DRIVE_ID, or SHAREPOINT_SITE_ID, or SHAREPOINT_SITE_URL")
        p = urllib.parse.urlparse(surl)
        site_path = p.path.rstrip("/")
        site_ref = f"/sites/{p.hostname}:{site_path}" if site_path else f"/sites/{p.hostname}"
        site = graph(cfg, "GET", site_ref)
        site_id = site["id"]
    lib = cfg["SHAREPOINT_LIBRARY_NAME"].lower()
    drives = graph(cfg, "GET", f"/sites/{site_id}/drives").get("value", [])
    for d in drives:
        if (d.get("name") or "").lower() == lib:
            _drive["id"] = d["id"]; return _drive["id"]
    for d in drives:
        if lib in (d.get("name") or "").lower():
            _drive["id"] = d["id"]; return _drive["id"]
    die(f"Library '{cfg['SHAREPOINT_LIBRARY_NAME']}' not found. Available: "
        + ", ".join(d.get("name", "?") for d in drives))


def list_children(cfg, path):
    drive = resolve_drive(cfg)
    path = path.strip("/")
    if path:
        url = f"/drives/{drive}/root:/{urllib.parse.quote(path)}:/children?$top=200"
    else:
        url = f"/drives/{drive}/root/children?$top=200"
    items = []
    while url:
        data = graph(cfg, "GET", url)
        for it in data.get("value", []):
            items.append({
                "name": it["name"],
                "type": "folder" if it.get("folder") else "file",
                "id": it["id"],
                "size": it.get("size"),
                "childCount": (it.get("folder") or {}).get("childCount"),
                "webUrl": it.get("webUrl"),
                "lastModified": it.get("lastModifiedDateTime"),
                "path": (path + "/" if path else "") + it["name"],
            })
        url = data.get("@odata.nextLink")
    return items


def norm(s):
    return re.sub(r"[^\w\s-]", "", re.sub(r"\s+", " ", (s or "").strip().lower()))


def find_folder(cfg, name, subfolder=None):
    base = cfg["SHAREPOINT_BASE_FOLDER"] + (f"/{subfolder}" if subfolder else "")
    folders = [c for c in list_children(cfg, base) if c["type"] == "folder"]
    target = norm(name)
    scored = []
    for f in folders:
        r = difflib.SequenceMatcher(None, target, norm(f["name"])).ratio()
        scored.append((r, f))
    scored.sort(key=lambda x: x[0], reverse=True)
    return base, scored


def walk_files(cfg, path, out, depth=0, maxdepth=4):
    for c in list_children(cfg, path):
        if c["type"] == "file":
            out.append(c)
        elif depth < maxdepth:
            walk_files(cfg, c["path"], out, depth + 1, maxdepth)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command")
    ap.add_argument("args", nargs="*")
    ap.add_argument("--config")
    ap.add_argument("--subfolder")
    ap.add_argument("--threshold", type=float, default=0.6)
    a = ap.parse_args()
    cfg = load_config(a.config)
    cmd = a.command

    if cmd == "test":
        get_token(cfg)
        drive = resolve_drive(cfg)
        base = cfg["SHAREPOINT_BASE_FOLDER"]
        folders = [c for c in list_children(cfg, base) if c["type"] == "folder"]
        print(json.dumps({"ok": True, "authenticated": True, "driveId": drive,
                          "baseFolder": base, "personFolderCount": len(folders),
                          "sample": [f["name"] for f in folders[:15]]}, indent=2))

    elif cmd == "list-folders":
        base = cfg["SHAREPOINT_BASE_FOLDER"] + (f"/{a.subfolder}" if a.subfolder else "")
        folders = [c for c in list_children(cfg, base) if c["type"] == "folder"]
        print(json.dumps({"ok": True, "base": base, "count": len(folders),
                          "folders": folders}, indent=2))

    elif cmd == "find":
        base, scored = find_folder(cfg, a.args[0], a.subfolder)
        top = [{"confidence": round(r, 3), "name": f["name"], "path": f["path"],
                "childCount": f["childCount"], "webUrl": f["webUrl"]}
               for r, f in scored[:5]]
        print(json.dumps({"ok": True, "query": a.args[0], "base": base, "matches": top}, indent=2))

    elif cmd == "ls":
        print(json.dumps({"ok": True, "path": a.args[0],
                          "items": list_children(cfg, a.args[0])}, indent=2))

    elif cmd == "tree":
        base, scored = find_folder(cfg, a.args[0], a.subfolder)
        if not scored or scored[0][0] < a.threshold:
            print(json.dumps({"ok": True, "query": a.args[0], "matched": None,
                              "base": base,
                              "closest": [{"confidence": round(r, 3), "name": f["name"]}
                                          for r, f in scored[:5]]}, indent=2)); return
        conf, folder = scored[0]
        files = []
        walk_files(cfg, folder["path"], files)
        print(json.dumps({"ok": True, "query": a.args[0], "matched": folder["name"],
                          "confidence": round(conf, 3), "folderPath": folder["path"],
                          "fileCount": len(files), "files": files}, indent=2))

    elif cmd == "search":
        drive = resolve_drive(cfg)
        q = urllib.parse.quote(a.args[0])
        data = graph(cfg, "GET", f"/drives/{drive}/root/search(q='{q}')?$top=100")
        items = [{"name": it["name"], "id": it["id"],
                  "type": "folder" if it.get("folder") else "file",
                  "webUrl": it.get("webUrl"),
                  "parent": (it.get("parentReference") or {}).get("path")}
                 for it in data.get("value", [])]
        print(json.dumps({"ok": True, "query": a.args[0], "count": len(items),
                          "results": items}, indent=2))

    elif cmd == "download":
        drive = resolve_drive(cfg)
        path, dest = a.args[0], a.args[1]
        blob = graph(cfg, "GET",
                     f"/drives/{drive}/root:/{urllib.parse.quote(path.strip('/'))}:/content", raw=True)
        os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(blob)
        print(json.dumps({"ok": True, "downloaded": path, "dest": dest, "bytes": len(blob)}, indent=2))

    elif cmd == "download-id":
        drive = resolve_drive(cfg)
        item_id, dest = a.args[0], a.args[1]
        blob = graph(cfg, "GET", f"/drives/{drive}/items/{item_id}/content", raw=True)
        os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(blob)
        print(json.dumps({"ok": True, "downloaded": item_id, "dest": dest, "bytes": len(blob)}, indent=2))

    else:
        die(f"Unknown command: {cmd}")


if __name__ == "__main__":
    main()
