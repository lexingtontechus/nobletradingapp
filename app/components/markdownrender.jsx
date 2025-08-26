"use client";

// Simple markdown parser for basic formatting
function parseMarkdown(text) {
  if (!text) return text;

  // Convert **bold** to <strong>
  text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Convert *italic* to <em>
  text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Convert [link text](url) to <a>
  text = text.replace(
    /\[([^\]]+)\]$$([^)]+)$$/g,
    '<a href="$2" class="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Convert line breaks to <br>
  text = text.replace(/\n/g, "<br>");

  // Convert - list items to <ul><li>
  const lines = text.split("<br>");
  let inList = false;
  const processedLines = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("- ")) {
      if (!inList) {
        processedLines.push('<ul class="list-none list-outside space-y-1">');
        inList = true;
      }
      processedLines.push(`<li>${trimmedLine.substring(2)}</li>`);
    } else {
      if (inList) {
        processedLines.push("</ul>");
        inList = false;
      }
      if (trimmedLine) {
        processedLines.push(line);
      }
    }
  }

  if (inList) {
    processedLines.push("</ul>");
  }

  return processedLines.join("");
}

export function MarkdownRenderer({ content, className = "" }) {
  const htmlContent = parseMarkdown(content);

  return (
    <div
      className={`mt-6 flex flex-col gap-2 text-xs max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}
{
  /*prose prose-sm*/
}
