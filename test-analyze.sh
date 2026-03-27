#!/bin/bash
SESSION_ID="XMkI_g7j3Ap_"
API="https://vid2creative.napptixaiuse.workers.dev/api/analyze"
FRAMES_DIR="/c/Users/krish/Downloads/vid22/test-frames"

for i in $(seq 1 19); do
  idx=$((i - 1))
  timestamp=$idx
  FILE=$(printf "${FRAMES_DIR}/frame_%03d.jpg" $i)

  echo "--- Frame $idx (${timestamp}s) ---"

  # Convert to base64 (strip newlines)
  B64=$(base64 -w0 "$FILE")

  # Build JSON payload
  PAYLOAD=$(printf '{"sessionId":"%s","frameIndex":%d,"timestamp":%d,"imageBase64":"%s"}' \
    "$SESSION_ID" "$idx" "$timestamp" "$B64")

  # Send to API
  RESULT=$(curl -s -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    --max-time 30)

  # Show key parts of the analysis
  echo "$RESULT" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    a = r.get('analysis', {})
    print(f\"  Scene: {a.get('sceneType','?')}  |  Mood: {a.get('mood','?')}  |  Importance: {a.get('importance','?')}\")
    print(f\"  Description: {a.get('description','?')}\")
    cta = a.get('cta', {})
    print(f\"  CTA: '{cta.get('text','')}' at ({cta.get('position',{}).get('x','?')},{cta.get('position',{}).get('y','?')}) style={cta.get('style','')}\")
    ov = a.get('overlay', {})
    if ov.get('type','none') != 'none':
        print(f\"  Overlay: {ov.get('type','')} '{ov.get('text','')}' at {ov.get('position','')}\")
    n = r.get('neurons', {})
    print(f\"  Neurons: {n.get('dailyTotal',0)}/{n.get('dailyLimit',0)}\")
except Exception as e:
    print(f'  Parse error: {e}')
    print(f'  Raw: {sys.stdin.read()[:200]}')
" 2>&1 || echo "  [python not available, raw output:]" && echo "$RESULT" | head -1

  echo ""
done

echo "=== ALL FRAMES ANALYZED ==="
