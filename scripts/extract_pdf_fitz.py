import fitz
import re

def main():
    pdf_path = "Designing-Multi-Agent-Systems.pdf"
    try:
        doc = fitz.open(pdf_path)
        full_text = ""
        for page in doc:
            full_text += page.get_text() + "\n"
            
        print(f"Total characters: {len(full_text)}")
        
        print("\n--- POTENTIAL TABLE OF CONTENTS ---")
        toc_text = ""
        for i in range(min(15, len(doc))):
             toc_text += doc[i].get_text()
        
        toc_start = toc_text.find("Contents")
        if toc_start != -1:
            print(toc_text[toc_start:toc_start+3000])
        else:
            print(toc_text[:3000])
            
        keywords = ["Pattern", "Architecture", "Memory", "Planning", "Reflection", "Feedback", "Orchestrator", "Decomposition", "Router", "Manager", "Human-in-the-loop", "Evaluation"]
        
        print("\n--- KEYWORD CONTEXTS ---")
        for kw in keywords:
            print(f"\n[Keyword: {kw}]")
            matches = [m.start() for m in re.finditer(kw, full_text, re.IGNORECASE)]
            
            # Pick a few distributed matches (beginning, middle, end) to get overview
            if not matches:
                continue
                
            indices = [0]
            if len(matches) > 1: indices.append(len(matches)//2)
            if len(matches) > 2: indices.append(len(matches)-1)
            
            selected_matches = [matches[i] for i in indices]
            
            for i, pos in enumerate(selected_matches):
                start = max(0, pos - 400)
                end = min(len(full_text), pos + 600)
                context = full_text[start:end].replace('\n', ' ')
                print(f"Match {i+1}: ...{context}...\n")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
