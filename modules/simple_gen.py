import os
import sys
import json
from google import genai
from dotenv import load_dotenv

# Load .env from project root (up one level)
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(project_root, '.env'))

api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("ERROR: GEMINI_API_KEY not found in env")
    sys.exit(1)

client = genai.Client(api_key=api_key)

if len(sys.argv) < 3:
    print("Usage: simple_gen.py <model> <prompt_file>")
    sys.exit(1)

model_name = sys.argv[1]
prompt_file = sys.argv[2]

try:
    with open(prompt_file, 'r', encoding='utf-8') as f:
        prompt = f.read()
except Exception as e:
    print(f"ERROR reading prompt file: {e}")
    sys.exit(1)

try:
    # Generate content
    response = client.models.generate_content(
        model=model_name,
        contents=prompt
    )
    if response.text:
        print(response.text)
    else:
        # Check finish reason
        reason = "Unknown"
        if response.candidates:
            reason = response.candidates[0].finish_reason
        print(f"ERROR: Empty response text. Finish reason: {reason}")
except Exception as e:
    print(f"ERROR: {e}")
