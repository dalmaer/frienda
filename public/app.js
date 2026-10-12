const $ = (selector) => document.querySelector(selector);
const signerGrid = $('#signer-grid');
const signerSelect = $('#signer-select');
const canvas = $('#signature-pad');
const context = canvas.getContext('2d');
const strokes = [];
let activeStroke = null;
let state = { signers: [], emailEnabled: false };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function signedLabel(signer) {
  if (!signer.signed) return 'Awaiting signature';
  return signer.method === 'email-link' ? 'Email link verified' : 'Handwritten mark';
}

function render() {
  const signed = state.signers.filter((signer) => signer.signed).length;
  $('#progress').textContent = `${signed} of ${state.signers.length} signed`;
  signerGrid.innerHTML = state.signers.map((signer) => `
    <article class="signer-card">
      <div class="signer-top"><span class="signer-name">${escapeHtml(signer.name)}</span><span class="status ${signer.signed ? 'signed' : ''}">${signer.signed ? 'SIGNED' : 'PENDING'}</span></div>
      <div class="signer-meta"><span>${escapeHtml(signedLabel(signer))}</span><span class="group-note">${escapeHtml(signer.group)}</span></div>
    </article>`).join('');
  const previous = signerSelect.value;
  signerSelect.innerHTML = '<option value="">Choose your name…</option>' + state.signers
    .filter((signer) => !signer.signed)
    .map((signer) => `<option value="${escapeHtml(signer.id)}">${escapeHtml(signer.name)}</option>`).join('');
  if (state.signers.some((signer) => signer.id === previous && !signer.signed)) signerSelect.value = previous;
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
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineWidth = 2.1;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#342b23';
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
resizeCanvas();

$('#clear-signature').addEventListener('click', () => {
  strokes.splice(0, strokes.length);
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);
  $('#signature-pad').nextElementSibling.style.display = '';
});

$('#manual-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const output = $('#manual-message');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const signerId = signerSelect.value;
  if (!signerId || !$('#manual-consent').checked || strokes.length === 0 || strokes.every((stroke) => stroke.length < 2)) {
    message(output, 'Choose your name, affirm the pledge, and add a little scribble first.', true);
    return;
  }
  button.disabled = true;
  message(output, 'Saving your mark…');
  try {
    const response = await fetch('/api/manual-sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signerId, accepted: true, strokes }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save that signature.');
    state.signers = result.signers;
    render();
    strokes.splice(0, strokes.length);
    $('#manual-form').reset();
    const rect = canvas.getBoundingClientRect();
    context.clearRect(0, 0, rect.width, rect.height);
    $('#signature-pad').nextElementSibling.style.display = '';
    message(output, 'Signed and saved. Your secrets are now under tiny-dragon protection.');
  } catch (error) {
    message(output, error.message, true);
  } finally {
    button.disabled = false;
  }
});

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

async function openEmailConfirmation() {
  const params = new URLSearchParams(window.location.search);
  const emailToken = params.get('token');
  const emailSigner = state.signers.find((signer) => signer.id === params.get('signer'));
  if (!emailToken || !emailSigner) return;
  $('#email-title').textContent = `${emailSigner.name}, your FrieNDA is ready.`;
  $('#email-confirm').showModal();
  $('#confirm-email-sign').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const output = $('#email-message');
    if (!$('#email-consent').checked) return message(output, 'Please affirm the pledge before signing.', true);
    button.disabled = true;
    message(output, 'Recording your email-verified assent…');
    try {
      const response = await fetch('/api/email-sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: emailToken, accepted: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not verify that link.');
      state.signers = result.signers;
      render();
      message(output, 'Signed. Your pledge is recorded.');
      history.replaceState(null, '', '/');
    } catch (error) {
      message(output, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

refresh().then(openEmailConfirmation).catch((error) => {
  signerGrid.textContent = error.message;
  $('#progress').textContent = 'Status unavailable';
});
