const $ = (selector) => document.querySelector(selector);
const signerGrid = $('#signer-grid');
const canvas = $('#signature-pad');
const context = canvas.getContext('2d');
const strokes = [];
let activeStroke = null;
let state = { signers: [], emailEnabled: false };

const fragment = new URLSearchParams(window.location.hash.slice(1));
const pendingInvite = { signerId: fragment.get('signer'), token: fragment.get('token') };
if (pendingInvite.signerId || pendingInvite.token) {
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function signedLabel(signer) {
  if (!signer.signed) return 'Awaiting signature';
  return 'Email link verified';
}

function render() {
  const signed = state.signers.filter((signer) => signer.signed).length;
  $('#progress').textContent = `${signed} of ${state.signers.length} signed`;
  signerGrid.innerHTML = state.signers.map((signer) => `
    <article class="signer-card" tabindex="0">
      <img class="signer-photo" src="/photos/${encodeURIComponent(signer.id)}.jpg" alt="" loading="lazy" decoding="async">
      <div class="signer-top"><span class="signer-name">${escapeHtml(signer.name)}</span><span class="status ${signer.signed ? 'signed' : ''}">${signer.signed ? 'SIGNED' : 'PENDING'}</span></div>
      <div class="signer-meta"><span>${escapeHtml(signedLabel(signer))}</span><span class="group-note">${escapeHtml(signer.group)}</span></div>
    </article>`).join('');
  $('#email-admin').hidden = !state.emailEnabled;
  $('#invite-buttons').innerHTML = state.signers.map((signer) => `<button type="button" data-invite="${escapeHtml(signer.id)}" ${signer.signed ? 'disabled' : ''}>${signer.signed ? 'Signed · ' : 'Send link · '}${escapeHtml(signer.name)}</button>`).join('');
}

async function refresh() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the signing status.');
  state = await response.json();
  render();
}

function message(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle('error', error);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineWidth = 2.1;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#342b23';
}

function clearSignature() {
  strokes.splice(0, strokes.length);
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);
  $('#signature-pad').nextElementSibling.style.display = '';
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  activeStroke = [pointFromEvent(event)];
  strokes.push(activeStroke);
  $('#signature-pad').nextElementSibling.style.display = 'none';
});
canvas.addEventListener('pointermove', (event) => {
  if (!activeStroke) return;
  const point = pointFromEvent(event);
  activeStroke.push(point);
  const rect = canvas.getBoundingClientRect();
  const previous = activeStroke.at(-2);
  context.beginPath();
  context.moveTo(previous[0] * rect.width, previous[1] * rect.height);
  context.lineTo(point[0] * rect.width, point[1] * rect.height);
  context.stroke();
});
canvas.addEventListener('pointerup', () => { activeStroke = null; });
canvas.addEventListener('pointercancel', () => { activeStroke = null; });
window.addEventListener('resize', resizeCanvas);
$('#email-confirm').addEventListener('close', () => { activeStroke = null; });

$('#clear-signature').addEventListener('click', clearSignature);

$('#invite-buttons').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-invite]');
  if (!button) return;
  const output = $('#invite-message');
  const token = $('#admin-token').value;
  if (!token) return message(output, 'Enter the organizer token first.', true);
  button.disabled = true;
  message(output, 'Sending one personal link…');
  try {
    const response = await fetch('/api/admin/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ signerId: button.dataset.invite }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not send the link.');
    message(output, result.message);
  } catch (error) {
    message(output, error.message, true);
  } finally {
    button.disabled = false;
  }
});

function openEmailConfirmation() {
  if (!pendingInvite.token || !pendingInvite.signerId) return;
  const signer = state.signers.find((candidate) => candidate.id === pendingInvite.signerId);
  if (!signer || signer.signed) {
    message($('#email-message'), signer ? 'This pledge has already been signed.' : 'This signing link is not recognized.', true);
    $('#email-confirm').showModal();
    $('#confirm-email-sign').disabled = true;
    return;
  }
  $('#email-title').textContent = `${signer.name}, your FrieNDA is ready.`;
  $('#email-confirm').showModal();
  resizeCanvas();
}

$('#confirm-email-sign').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const output = $('#email-message');
  const hasMark = strokes.some((stroke) => stroke.length >= 2);
  if (!$('#email-consent').checked || !hasMark) {
    return message(output, !$('#email-consent').checked ? 'Please affirm the pledge before signing.' : 'Add your scribble before signing.', true);
  }
  button.disabled = true;
  message(output, 'Recording your email-verified assent…');
  try {
    const response = await fetch('/api/email-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pendingInvite.token, accepted: true, strokes }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not verify that link.');
    state.signers = result.signers;
    render();
    pendingInvite.token = null;
    strokes.splice(0, strokes.length);
    $('#email-consent').checked = false;
    message(output, 'Signed. Your pledge is recorded.');
    button.disabled = true;
  } catch (error) {
    message(output, error.message, true);
    button.disabled = false;
  }
});

refresh().then(openEmailConfirmation).catch((error) => {
  signerGrid.textContent = error.message;
  $('#progress').textContent = 'Status unavailable';
});
