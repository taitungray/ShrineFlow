function cleanWhitespace(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function sentenceParts(value) {
  return value
    .split(/(?<=[。！？!?；;])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatParagraphs(value) {
  const source = cleanWhitespace(value);
  if (!source) return '';
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) return lines.join('\n\n');

  const sentences = sentenceParts(source);
  if (sentences.length <= 1) return source;
  const paragraphs = [];
  let current = [];
  sentences.forEach((sentence) => {
    current.push(sentence);
    if (current.length >= 2 || current.join('').length >= 72) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  });
  if (current.length) paragraphs.push(current.join(' '));
  return paragraphs.join('\n\n');
}

function formatReel(value) {
  const source = cleanWhitespace(value);
  if (!source) return '';
  const marker = source.match(/影片祝福\s*[:：]?/);
  if (!marker) return formatParagraphs(source);

  const description = formatParagraphs(source.slice(0, marker.index));
  const blessingSource = source.slice(marker.index + marker[0].length).trim();
  const blessingLines = sentenceParts(blessingSource).length > 1
    ? sentenceParts(blessingSource)
    : blessingSource.split('\n').map((line) => line.trim()).filter(Boolean);
  const blessingBlock = ['影片祝福：', blessingLines.join('\n')].filter(Boolean).join('\n');
  return [description, blessingBlock].filter(Boolean).join('\n\n');
}

export function formatCopy(value, type = 'facebook') {
  return type === 'reel' ? formatReel(value) : formatParagraphs(value);
}

export function normalizePostCopy(post) {
  return {
    ...post,
    facebook: formatCopy(post.facebook, 'facebook'),
    reel: formatCopy(post.reel, 'reel'),
  };
}
