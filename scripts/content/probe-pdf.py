import pymupdf, os, sys, io, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
D = r"D:\study\content\资料"
out = r"D:\study\tmp-pdf"
os.makedirs(out, exist_ok=True)

rows = []
for fn in sorted(os.listdir(D)):
    if not fn.lower().endswith('.pdf'):
        continue
    p = os.path.join(D, fn)
    try:
        doc = pymupdf.open(p)
    except Exception as e:
        rows.append({'file': fn, 'error': str(e)})
        continue
    n = len(doc)
    total_chars = 0
    img_pages = 0
    all_text = []
    for i in range(n):
        pg = doc[i]
        t = pg.get_text("text")
        total_chars += len(t.strip())
        if len(t.strip()) < 20:
            img_pages += 1
        all_text.append(f"----- p{i+1} -----\n{t}")
    txt = "\n".join(all_text)
    safe = fn.replace('.pdf', '').replace('/', '_')
    with open(os.path.join(out, safe + '.txt'), 'w', encoding='utf-8') as f:
        f.write(txt)
    rows.append({
        'file': fn, 'pages': n, 'chars': total_chars,
        'img_like_pages': img_pages,
        'chars_per_page': round(total_chars / n, 1) if n else 0,
        'mb': round(os.path.getsize(p) / 1048576, 1),
    })
    doc.close()

print(f"{'file':<52} {'pg':>4} {'chars':>8} {'txtPg':>6} {'c/p':>7} {'MB':>6}")
for r in rows:
    if 'error' in r:
        print(r['file'], 'ERROR', r['error'])
        continue
    print(f"{r['file'][:50]:<52} {r['pages']:>4} {r['chars']:>8} {r['img_like_pages']:>6} {r['chars_per_page']:>7} {r['mb']:>6}")
