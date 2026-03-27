#!/bin/bash
SESSION_ID="VG2wNSpNJp47"
API="https://vid2creative.napptixaiuse.workers.dev/api/analyze"
FRAMES_DIR="/c/Users/krish/Downloads/vid22/test-frames"

for i in $(seq 1 19); do
  idx=$((i - 1))
  FILE=$(printf "${FRAMES_DIR}/frame_%03d.jpg" $i)
  echo "--- Frame $idx (${idx}s) ---"

  B64=$(base64 -w0 "$FILE")
  echo "{\"sessionId\":\"$SESSION_ID\",\"frameIndex\":$idx,\"timestamp\":$idx,\"imageBase64\":\"$B64\"}" > /tmp/frame_payload.json

  RESULT=$(curl -s -X POST "$API" \
    -H "Content-Type: application/json" \
    -d @/tmp/frame_payload.json --max-time 30)

  echo "$RESULT" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    a = r.get('analysis', {})
    raw = r.get('rawResponse', '')
    print(f\"  Scene: {a.get('sceneType','?')}  |  Mood: {a.get('mood','?')}  |  Importance: {a.get('importance','?')}\")
    print(f\"  Description: {a.get('description','?')}\")
    cta = a.get('cta', {})
    print(f\"  CTA: '{cta.get('text','')}' at ({cta.get('position',{}).get('x','?')},{cta.get('position',{}).get('y','?')}) style={cta.get('style','')}\")
    if raw:
        print(f\"  Raw AI: {raw[:150]}\")
except Exception as e:
    print(f'  Error: {e}')
" 2>&1
  echo ""
done

echo "=== DONE ==="
