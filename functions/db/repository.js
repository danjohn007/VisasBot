import { last10Digits, normalizePhone } from "../utils/normalizeText.js";

export async function ensureCatalogSeed(pool) {
  const services = [
    ["01_VISA_USA_PRIMERA_VEZ", "Visa Americana - Primera vez", "VISA_USA_PRIMERA_VEZ", 1],
    ["02_VISA_USA_RENOVACION", "Visa Americana - Renovación", "VISA_USA_RENOVACION", 2],
    ["03_PASAPORTE_MEXICANO", "Pasaporte Mexicano", "PASAPORTE_MEXICANO", 3],
    ["04_PASAPORTE_AMERICANO", "Pasaporte Americano", "PASAPORTE_AMERICANO", 4],
    ["05_VISA_CANADA", "Visa Canadiense", "VISA_CANADA", 5],
    ["06_ETA_CANADA", "eTA Canadiense", "ETA_CANADA", 6],
    ["07_VISA_AUSTRALIA", "Visa para Australia", "VISA_AUSTRALIA", 7],
    ["08_VISA_CHINA", "Visa para China", "VISA_CHINA", 8],
    ["09_ACTA_NACIMIENTO", "Acta de Nacimiento", "ACTA_NACIMIENTO", 9],
    ["10_CLIENTE_SEGUIMIENTO", "Ya soy cliente - Seguimiento", "CLIENTE_SEGUIMIENTO", 10],
    ["11_ASESOR", "Hablar con un asesor", "ASESOR", 11],
  ];

  const sql = `
    INSERT INTO bot_service_catalog (code, name, flow_key, sort_order, is_active)
    VALUES (?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      flow_key = VALUES(flow_key),
      sort_order = VALUES(sort_order),
      is_active = 1
  `;

  for (const service of services) await pool.execute(sql, service);
}

export async function getOrCreateContact(pool, { waId, phone, profileName }) {
  const normalizedPhone = normalizePhone(phone || waId);
  const [result] = await pool.execute(
    `INSERT INTO bot_contacts (wa_id, phone, profile_name, source, first_contact_at, last_contact_at)
     VALUES (?, ?, ?, 'WhatsApp', NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       phone = VALUES(phone),
       profile_name = COALESCE(profile_name, NULLIF(VALUES(profile_name), '')),
       last_contact_at = NOW()`,
    [waId, normalizedPhone, profileName || null]
  );
  const [rows] = await pool.execute(`SELECT * FROM bot_contacts WHERE wa_id = ? LIMIT 1`, [waId]);
  const contact = rows[0] || null;
  if (contact) {
    // Bandera temporal: permite distinguir un contacto realmente nuevo
    // de uno creado en versiones anteriores sin cambiar el esquema.
    contact._is_new_contact = Number(result?.affectedRows || 0) === 1;
  }
  return contact;
}

export async function getOrCreateSession(pool, contactId) {
  await pool.execute(
    `INSERT INTO bot_sessions (contact_id, state, human_handoff, last_message_at)
     VALUES (?, 'MENU_PRINCIPAL', 0, NOW())
     ON DUPLICATE KEY UPDATE last_message_at = NOW()`,
    [contactId]
  );
  const [rows] = await pool.execute(`SELECT * FROM bot_sessions WHERE contact_id = ? LIMIT 1`, [contactId]);
  return rows[0];
}

async function selectNextRoundRobinAdvisor(conn) {
  const [advisors] = await conn.execute(
    `SELECT id, full_name, created_at
       FROM users
      WHERE role = 'Asesor'
        AND is_active = 1
      ORDER BY created_at ASC, id ASC`
  );

  if (!advisors.length) return null;

  try {
    await conn.execute(
      `INSERT INTO bot_assignment_round_robin
        (id, last_assigned_user_id, updated_at)
       VALUES (1, NULL, NOW())
       ON DUPLICATE KEY UPDATE id = VALUES(id)`
    );

    const [stateRows] = await conn.execute(
      `SELECT last_assigned_user_id
         FROM bot_assignment_round_robin
        WHERE id = 1
        FOR UPDATE`
    );

    const lastId = Number(stateRows[0]?.last_assigned_user_id || 0);
    const lastIndex = advisors.findIndex((advisor) => Number(advisor.id) === lastId);
    const selected = advisors[lastIndex >= 0 ? (lastIndex + 1) % advisors.length : 0];

    await conn.execute(
      `UPDATE bot_assignment_round_robin
          SET last_assigned_user_id = ?, updated_at = NOW()
        WHERE id = 1`,
      [selected.id]
    );

    return selected;
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;

    const [fallbackRows] = await conn.execute(
      `SELECT u.id, u.full_name, COUNT(c.id) AS assigned_count
         FROM users u
         LEFT JOIN bot_conversations c
           ON c.assigned_agent_id = u.id
          AND c.status <> 'CLOSED'
        WHERE u.role = 'Asesor'
          AND u.is_active = 1
        GROUP BY u.id, u.full_name, u.created_at
        ORDER BY assigned_count ASC, u.created_at ASC, u.id ASC
        LIMIT 1`
    );
    return fallbackRows[0] || advisors[0];
  }
}

export async function ensureAutomaticConversationAssignment(pool, contactId) {
  const conn = await pool.getConnection();
  let assignment = null;
  let autoActivatedHuman = false;

  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT id, assigned_agent_id, assigned_agent_name, mode, status
         FROM bot_conversations
        WHERE contact_id = ?
        LIMIT 1
        FOR UPDATE`,
      [contactId]
    );

    const conversation = rows[0] || null;
    if (!conversation) {
      await conn.rollback();
      return null;
    }

    if (conversation.assigned_agent_id) {
      await conn.commit();
      return {
        conversationId: conversation.id,
        assignedAgentId: Number(conversation.assigned_agent_id),
        assignedAgentName: conversation.assigned_agent_name,
        existing: true,
      };
    }

    const advisor = await selectNextRoundRobinAdvisor(conn);
    if (!advisor) {
      await conn.commit();
      return null;
    }

    autoActivatedHuman = conversation.status === "WAITING_HUMAN";

    await conn.execute(
      `UPDATE bot_conversations
          SET assigned_agent_id = ?,
              assigned_agent_name = ?,
              mode = IF(status = 'WAITING_HUMAN', 'HUMAN', mode),
              status = IF(status = 'WAITING_HUMAN', 'IN_PROGRESS', status),
              handoff_taken_at = IF(status = 'WAITING_HUMAN', COALESCE(handoff_taken_at, NOW()), handoff_taken_at),
              updated_at = NOW()
        WHERE id = ?`,
      [advisor.id, advisor.full_name, conversation.id]
    );

    await conn.commit();

    assignment = {
      conversationId: conversation.id,
      assignedAgentId: Number(advisor.id),
      assignedAgentName: advisor.full_name,
      existing: false,
    };
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally {
    conn.release();
  }

  if (assignment?.conversationId) {
    await addConversationEvent(pool, {
      conversationId: assignment.conversationId,
      eventType: "AUTO_ASSIGNED",
      actorName: "Sistema",
      actorRole: "Sistema",
      detail: `Cliente asignado automáticamente a ${assignment.assignedAgentName} mediante rotación de asesoras.`,
      metadata: {
        assigned_agent_id: assignment.assignedAgentId,
        assigned_agent_name: assignment.assignedAgentName,
        strategy: "ROUND_ROBIN",
        human_mode_activated: autoActivatedHuman,
      },
    });
  }

  return assignment;
}

export async function getOrCreateConversation(pool, contactId) {
  await pool.execute(
    `INSERT INTO bot_conversations (contact_id, mode, status, last_message_at, created_at, updated_at)
     VALUES (?, 'BOT', 'OPEN', NOW(), NOW(), NOW())
     ON DUPLICATE KEY UPDATE last_message_at = NOW(), updated_at = NOW()`,
    [contactId]
  );

  await ensureAutomaticConversationAssignment(pool, contactId);

  const [rows] = await pool.execute(
    `SELECT * FROM bot_conversations WHERE contact_id = ? LIMIT 1`,
    [contactId]
  );
  return rows[0];
}


export async function getCapturedContactName(pool, contactId) {
  const [rows] = await pool.execute(
    `SELECT answer_value
       FROM bot_profile_answers
      WHERE contact_id = ?
        AND service_code = 'CONTACTO'
        AND question_key = 'NOMBRE_COMPLETO'
      LIMIT 1`,
    [contactId]
  );
  const value = String(rows[0]?.answer_value || "").trim();
  return value || null;
}

export async function saveCapturedContactName(pool, { contactId, fullName }) {
  const cleanName = String(fullName || "").replace(/\s+/g, " ").trim().slice(0, 150);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE bot_contacts
          SET profile_name = ?, last_contact_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [cleanName, contactId]
    );
    await conn.execute(
      `INSERT INTO bot_profile_answers
        (contact_id, service_code, question_key, question_label, answer_value, answer_label, created_at, updated_at)
       VALUES (?, 'CONTACTO', 'NOMBRE_COMPLETO', 'Nombre y apellido del contacto', ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         answer_value = VALUES(answer_value),
         answer_label = VALUES(answer_label),
         updated_at = NOW()`,
      [contactId, cleanName, cleanName]
    );
    await conn.execute(
      `UPDATE bot_sessions
          SET state = 'MENU_PRINCIPAL', last_message_at = NOW(), updated_at = NOW()
        WHERE contact_id = ?`,
      [contactId]
    );
    await conn.commit();
    return cleanName;
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally {
    conn.release();
  }
}

function withMeta(payload, meta) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return { ...payload, _crm_meta: meta };
  }
  return { raw: payload ?? null, _crm_meta: meta };
}

export async function saveInboundMessage(pool, { contactId, conversationId = null, metaMessageId, messageType, text, payload }) {
  const loggedPayload = withMeta(payload, { sender_type: "USER", conversation_id: conversationId });
  const [result] = await pool.execute(
    `INSERT IGNORE INTO bot_messages
      (contact_id, meta_message_id, direction, message_type, message_text, payload_json, created_at)
     VALUES (?, ?, 'IN', ?, ?, ?, NOW())`,
    [contactId, metaMessageId, messageType, text || null, JSON.stringify(loggedPayload)]
  );
  if (result.affectedRows === 1 && conversationId) {
    await pool.execute(
      `UPDATE bot_conversations
          SET last_message_at = NOW(), last_customer_message_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [conversationId]
    );
  }
  return result.affectedRows === 1;
}

export async function saveOutboundMessage(pool, {
  contactId,
  conversationId = null,
  metaMessageId,
  messageType,
  text,
  payload,
  senderType = "BOT",
  senderUserId = null,
  senderName = null,
  senderRole = null,
}) {
  const loggedPayload = withMeta(payload, {
    sender_type: senderType,
    sender_user_id: senderUserId,
    sender_name: senderName,
    sender_role: senderRole,
    conversation_id: conversationId,
  });
  await pool.execute(
    `INSERT IGNORE INTO bot_messages
      (contact_id, meta_message_id, direction, message_type, message_text, payload_json, created_at)
     VALUES (?, ?, 'OUT', ?, ?, ?, NOW())`,
    [contactId, metaMessageId || null, messageType, text || null, JSON.stringify(loggedPayload)]
  );
  if (conversationId) {
    await pool.execute(
      `UPDATE bot_conversations
          SET last_message_at = NOW(),
              last_staff_message_at = IF(? IN ('AGENT','ADMIN'), NOW(), last_staff_message_at),
              updated_at = NOW()
        WHERE id = ?`,
      [senderType, conversationId]
    );
  }
}

export async function addConversationEvent(pool, {
  conversationId,
  eventType,
  actorUserId = null,
  actorName = null,
  actorRole = null,
  detail = null,
  metadata = null,
}) {
  await pool.execute(
    `INSERT INTO bot_conversation_events
      (conversation_id, event_type, actor_user_id, actor_name, actor_role, detail, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [conversationId, eventType, actorUserId, actorName, actorRole, detail, JSON.stringify(metadata || null)]
  );
}

export async function resetToMainMenu(pool, contactId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE bot_sessions
          SET state = 'MENU_PRINCIPAL', flow_code = NULL, service_code = NULL,
              human_handoff = 0, last_message_at = NOW(), updated_at = NOW()
        WHERE contact_id = ?`,
      [contactId]
    );
    await conn.execute(
      `UPDATE bot_conversations
          SET mode = 'BOT', status = 'OPEN',
              handoff_reason = NULL, handoff_requested_at = NULL,
              bot_resume_state = 'MENU_PRINCIPAL', closed_at = NULL, updated_at = NOW()
        WHERE contact_id = ?`,
      [contactId]
    );
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally {
    conn.release();
  }
}

export async function selectService(pool, { contactId, service }) {
  const state = service.code === "10_CLIENTE_SEGUIMIENTO" ? "CLIENTE_SEGUIMIENTO" : "PENDIENTE_FLUJO";
  const contactType = service.code === "10_CLIENTE_SEGUIMIENTO" ? "CLIENTE_SEGUIMIENTO" : "PROSPECTO";
  const leadStatus = service.code === "10_CLIENTE_SEGUIMIENTO" ? "SEGUIMIENTO_SOLICITADO" : "SERVICIO_SELECCIONADO";

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [contactResult] = await conn.execute(
      `UPDATE bot_contacts
          SET service_code = ?, contact_type = ?, lead_status = ?, last_contact_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [service.code, contactType, leadStatus, contactId]
    );
    if (contactResult.affectedRows !== 1) throw Object.assign(new Error(`bot_contacts.id=${contactId} no encontrado.`), { code: "BOT_CONTACT_NOT_FOUND" });

    const [sessionResult] = await conn.execute(
      `UPDATE bot_sessions
          SET state = ?, flow_code = ?, service_code = ?, human_handoff = 0, last_message_at = NOW(), updated_at = NOW()
        WHERE contact_id = ?`,
      [state, service.flowKey, service.code, contactId]
    );
    if (sessionResult.affectedRows !== 1) throw Object.assign(new Error(`bot_sessions.contact_id=${contactId} no encontrado.`), { code: "BOT_SESSION_NOT_FOUND" });

    await conn.execute(
      `UPDATE bot_conversations
          SET service_code = ?, mode = 'BOT', status = 'OPEN',
              handoff_reason = NULL, handoff_requested_at = NULL,
              bot_resume_state = ?, closed_at = NULL, updated_at = NOW()
        WHERE contact_id = ?`,
      [service.code, state, contactId]
    );
    await conn.commit();
    return { state, contactType, leadStatus, humanHandoff: 0 };
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally {
    conn.release();
  }
}

export async function setSessionState(pool, contactId, state) {
  await pool.execute(
    `UPDATE bot_sessions SET state = ?, last_message_at = NOW(), updated_at = NOW() WHERE contact_id = ?`,
    [state, contactId]
  );
  await pool.execute(
    `UPDATE bot_conversations SET bot_resume_state = ?, updated_at = NOW() WHERE contact_id = ?`,
    [state, contactId]
  );
}

export async function requestHumanHandoff(pool, {
  contactId,
  reason = "El usuario solicitó hablar con una asesora.",
  resumeState = "PERFIL_COMPLETO",
}) {
  const conn = await pool.getConnection();
  let assignedAgentId = null;
  let assignedAgentName = null;

  try {
    await conn.beginTransaction();

    const [conversationRows] = await conn.execute(
      `SELECT id, assigned_agent_id, assigned_agent_name
         FROM bot_conversations
        WHERE contact_id = ?
        LIMIT 1
        FOR UPDATE`,
      [contactId]
    );
    const currentConversation = conversationRows[0] || null;
    assignedAgentId = currentConversation?.assigned_agent_id || null;
    assignedAgentName = currentConversation?.assigned_agent_name || null;

    await conn.execute(
      `UPDATE bot_sessions
          SET state = 'ASESOR_SOLICITADO', human_handoff = 1, last_message_at = NOW(), updated_at = NOW()
        WHERE contact_id = ?`,
      [contactId]
    );
    await conn.execute(
      `UPDATE bot_contacts SET lead_status = 'ATENCION_HUMANA', updated_at = NOW() WHERE id = ?`,
      [contactId]
    );

    if (assignedAgentId) {
      // Si este cliente ya pertenece a una asesora, vuelve directamente con ella.
      await conn.execute(
        `UPDATE bot_conversations
            SET mode = 'HUMAN', status = 'IN_PROGRESS',
                handoff_reason = ?, handoff_requested_at = NOW(),
                handoff_taken_at = COALESCE(handoff_taken_at, NOW()),
                bot_resume_state = ?, closed_at = NULL, updated_at = NOW()
          WHERE contact_id = ?`,
        [reason, resumeState || "PERFIL_COMPLETO", contactId]
      );
    } else {
      await conn.execute(
        `UPDATE bot_conversations
            SET mode = 'HUMAN', status = 'WAITING_HUMAN',
                assigned_agent_id = NULL, assigned_agent_name = NULL,
                handoff_reason = ?, handoff_requested_at = NOW(),
                handoff_taken_at = NULL, bot_resume_state = ?,
                closed_at = NULL, updated_at = NOW()
          WHERE contact_id = ?`,
        [reason, resumeState || "PERFIL_COMPLETO", contactId]
      );
    }

    await conn.commit();

    if (currentConversation?.id && assignedAgentId) {
      await addConversationEvent(pool, {
        conversationId: currentConversation.id,
        eventType: "RETURNED_TO_ASSIGNED_AGENT",
        actorName: "Sistema",
        actorRole: "Bot",
        detail: `El cliente solicitó atención humana nuevamente y fue devuelto a ${assignedAgentName || "su asesora asignada"}.`,
        metadata: { assigned_agent_id: Number(assignedAgentId) },
      });
    }
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally {
    conn.release();
  }
}

export async function clearProfileAnswers(pool, contactId, serviceCode) {
  try {
    await pool.execute(`DELETE FROM bot_profile_answers WHERE contact_id = ? AND service_code = ?`, [contactId, serviceCode]);
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
  }
}

export async function getFlowSteps(pool, serviceCode) {
  try {
    const [rows] = await pool.execute(
      `SELECT step_key, prompt_text, input_type, options_json, sort_order, is_required
         FROM bot_flow_steps
        WHERE service_code = ? AND is_active = 1
        ORDER BY sort_order ASC, id ASC`,
      [serviceCode]
    );
    return rows.map((row) => ({
      stepKey: row.step_key,
      prompt: row.prompt_text,
      inputType: row.input_type,
      options: (() => { try { return JSON.parse(row.options_json || "[]"); } catch { return []; } })(),
      sortOrder: Number(row.sort_order || 0),
      isRequired: Number(row.is_required || 0),
    }));
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

export async function getProfileAnswers(pool, contactId, serviceCode) {
  try {
    const [rows] = await pool.execute(
      `SELECT question_key, question_label, answer_value, answer_label, created_at, updated_at
         FROM bot_profile_answers
        WHERE contact_id = ? AND service_code = ?
        ORDER BY id ASC`,
      [contactId, serviceCode]
    );
    return rows;
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

export async function upsertProfileAnswer(pool, {
  contactId,
  serviceCode,
  questionKey,
  questionLabel,
  answerValue,
  answerLabel,
}) {
  await pool.execute(
    `INSERT INTO bot_profile_answers
      (contact_id, service_code, question_key, question_label, answer_value, answer_label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       question_label = VALUES(question_label),
       answer_value = VALUES(answer_value),
       answer_label = VALUES(answer_label),
       updated_at = NOW()`,
    [contactId, serviceCode, questionKey, questionLabel, answerValue, answerLabel]
  );
}

export async function markProfileComplete(pool, contactId) {
  await pool.execute(
    `UPDATE bot_sessions SET state = 'PERFIL_COMPLETO', human_handoff = 0, updated_at = NOW() WHERE contact_id = ?`,
    [contactId]
  );
  await pool.execute(
    `UPDATE bot_contacts SET lead_status = 'PERFIL_COMPLETO', updated_at = NOW() WHERE id = ?`,
    [contactId]
  );
  await pool.execute(
    `UPDATE bot_conversations SET mode = 'BOT', status = 'OPEN', bot_resume_state = 'PERFIL_COMPLETO', updated_at = NOW() WHERE contact_id = ?`,
    [contactId]
  );
  try {
    await pool.execute(
      `UPDATE bot_prospect_profiles
          SET completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
        WHERE contact_id = ?`,
      [contactId]
    );
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
  }
}

export async function getRecordedBotServices(pool, contactId) {
  try {
    const [rows] = await pool.execute(
      `SELECT
          pa.service_code,
          COALESCE(sc.name, pa.service_code) AS service_name,
          MAX(pa.updated_at) AS last_update,
          COUNT(*) AS answer_count
       FROM bot_profile_answers pa
       LEFT JOIN bot_service_catalog sc ON sc.code = pa.service_code
       WHERE pa.contact_id = ?
         AND pa.service_code NOT IN ('CONTACTO', '10_CLIENTE_SEGUIMIENTO', '11_ASESOR')
       GROUP BY pa.service_code, sc.name
       ORDER BY last_update DESC`,
      [contactId]
    );
    return rows || [];
  } catch {
    return [];
  }
}

async function getApplicationsForClientUser(pool, clientUserId) {
  if (!clientUserId) return [];
  const [rows] = await pool.execute(
    `SELECT id, folio, status, client_name, type, subtype, appointment_date, client_user_id, updated_at
       FROM applications
      WHERE client_user_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 10`,
    [clientUserId]
  );
  return rows || [];
}

async function getApplicationsByPhone(pool, phone10) {
  if (!phone10) return [];
  const [rows] = await pool.execute(
    `SELECT id, folio, status, client_name, type, subtype, appointment_date, client_user_id, updated_at
       FROM applications
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(data_json, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 10`,
    [`%${phone10}%`]
  );
  return rows || [];
}

export async function tryLinkExistingClient(pool, contact) {
  const phone10 = last10Digits(contact.phone || contact.wa_id);
  const services = await getRecordedBotServices(pool, contact.id);

  let user = null;
  let applications = [];

  // 1) Respetar vínculos que ya estaban guardados en bot_contacts.
  if (contact.client_user_id) {
    const [linkedUsers] = await pool.execute(
      `SELECT id, full_name, phone
         FROM users
        WHERE id = ? AND role = 'Cliente'
        LIMIT 1`,
      [contact.client_user_id]
    );
    user = linkedUsers[0] || null;
    applications = await getApplicationsForClientUser(pool, contact.client_user_id);
  }

  if (!applications.length && contact.application_id) {
    const [linkedApps] = await pool.execute(
      `SELECT id, folio, status, client_name, type, subtype, appointment_date, client_user_id, updated_at
         FROM applications
        WHERE id = ?
        LIMIT 1`,
      [contact.application_id]
    );
    if (linkedApps[0]) applications = linkedApps;
  }

  // 2) Compatibilidad con clientes que sí tienen teléfono en users.
  if (!user && phone10) {
    const [users] = await pool.execute(
      `SELECT id, full_name, phone
         FROM users
        WHERE role = 'Cliente'
          AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), 10) = ?
        ORDER BY id DESC
        LIMIT 1`,
      [phone10]
    );
    user = users[0] || null;
    if (user && !applications.length) {
      applications = await getApplicationsForClientUser(pool, user.id);
    }
  }

  // 3) Solicitudes antiguas pueden no tener client_user_id; buscar el teléfono
  //    directamente dentro de data_json.
  if (!applications.length && phone10) {
    applications = await getApplicationsByPhone(pool, phone10);
  }

  const application = applications[0] || null;
  const resolvedClientUserId = user?.id || application?.client_user_id || contact.client_user_id || null;

  if (application || services.length || resolvedClientUserId) {
    await pool.execute(
      `UPDATE bot_contacts
          SET is_existing_client = 1,
              client_user_id = COALESCE(?, client_user_id),
              application_id = COALESCE(?, application_id),
              updated_at = NOW()
        WHERE id = ?`,
      [resolvedClientUserId, application?.id || null, contact.id]
    );
  }

  return {
    user,
    application,
    applications,
    services,
    hasHistory: Boolean(application || applications.length || services.length || resolvedClientUserId),
  };
}

export async function createAdminEvent(pool, {
  contactId,
  waId,
  profileName,
  serviceCode,
  description,
  priority = "normal",
  action = "nuevo_contacto",
  metadata = null,
}) {
  try {
    await pool.execute(
      `INSERT INTO admin_control_events
       (module, action, entity_type, entity_id, description, metadata_json, priority, is_read, created_at)
       VALUES ('chatbot_whatsapp', ?, 'bot_contact', ?, ?, ?, ?, 0, NOW())`,
      [
        action,
        contactId,
        description,
        JSON.stringify({
          wa_id: waId,
          profile_name: profileName || null,
          service_code: serviceCode || null,
          ...(metadata || {}),
        }),
        priority,
      ]
    );
  } catch {}
}

export async function getConversationById(pool, conversationId) {
  const [rows] = await pool.execute(
    `SELECT c.*, bc.wa_id, bc.phone, bc.profile_name, bc.service_code AS contact_service_code
       FROM bot_conversations c
       INNER JOIN bot_contacts bc ON bc.id = c.contact_id
      WHERE c.id = ? LIMIT 1`,
    [conversationId]
  );
  return rows[0] || null;
}

export async function takeConversation(pool, { conversationId, actorUserId, actorName, actorRole }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(`SELECT * FROM bot_conversations WHERE id = ? FOR UPDATE`, [conversationId]);
    const conversation = rows[0];
    if (!conversation) throw Object.assign(new Error("Conversación no encontrada."), { code: "CONVERSATION_NOT_FOUND" });
    if (conversation.status === "CLOSED") throw Object.assign(new Error("La conversación está cerrada."), { code: "CONVERSATION_CLOSED" });
    if (actorRole !== "Administrador") {
      const assignedToActor = Number(conversation.assigned_agent_id || 0) === Number(actorUserId);
      const availableWaiting = conversation.status === "WAITING_HUMAN";
      const ownBotConversation = conversation.status === "OPEN" && conversation.mode === "BOT" && assignedToActor;

      if (!availableWaiting && !ownBotConversation) {
        throw Object.assign(new Error("Esta conversación ya no está disponible para tomar."), { code: "CONVERSATION_NOT_AVAILABLE" });
      }

      if (conversation.assigned_agent_id && !assignedToActor) {
        throw Object.assign(new Error("La conversación ya fue tomada por otra asesora."), { code: "CONVERSATION_ASSIGNED" });
      }
    }
    const preserveExistingAssignment =
      actorRole === "Administrador" &&
      conversation.assigned_agent_id &&
      Number(conversation.assigned_agent_id) !== Number(actorUserId);

    const targetAgentId = preserveExistingAssignment ? conversation.assigned_agent_id : actorUserId;
    const targetAgentName = preserveExistingAssignment ? conversation.assigned_agent_name : actorName;

    await conn.execute(
      `UPDATE bot_conversations
          SET mode = 'HUMAN', status = 'IN_PROGRESS', assigned_agent_id = ?, assigned_agent_name = ?,
              handoff_taken_at = COALESCE(handoff_taken_at, NOW()), updated_at = NOW()
        WHERE id = ?`,
      [targetAgentId, targetAgentName, conversationId]
    );
    await conn.commit();
    await addConversationEvent(pool, {
      conversationId,
      eventType: preserveExistingAssignment ? "HUMAN_MODE_REACTIVATED" : "TAKEN",
      actorUserId,
      actorName,
      actorRole,
      detail: preserveExistingAssignment
        ? `${actorName} reactivó la atención humana. El cliente conserva su asignación a ${targetAgentName}.`
        : `${actorName} tomó la conversación.`,
      metadata: {
        assigned_agent_id: Number(targetAgentId),
        assigned_agent_name: targetAgentName,
        assignment_preserved: Boolean(preserveExistingAssignment),
      },
    });
    return await getConversationById(pool, conversationId);
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally { conn.release(); }
}

export async function releaseConversationToBot(pool, { conversationId, actorUserId, actorName, actorRole }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(`SELECT * FROM bot_conversations WHERE id = ? FOR UPDATE`, [conversationId]);
    const conversation = rows[0];
    if (!conversation) throw Object.assign(new Error("Conversación no encontrada."), { code: "CONVERSATION_NOT_FOUND" });
    if (actorRole !== "Administrador" && Number(conversation.assigned_agent_id || 0) !== Number(actorUserId)) {
      throw Object.assign(new Error("Solo la asesora asignada puede devolver esta conversación al bot."), { code: "NOT_ASSIGNED" });
    }
    const resumeState = conversation.bot_resume_state || "PERFIL_COMPLETO";
    await conn.execute(
      `UPDATE bot_conversations
          SET mode = 'BOT', status = 'OPEN',
              handoff_reason = NULL, handoff_requested_at = NULL,
              closed_at = NULL, updated_at = NOW()
        WHERE id = ?`,
      [conversationId]
    );
    await conn.execute(
      `UPDATE bot_sessions SET state = ?, human_handoff = 0, updated_at = NOW() WHERE contact_id = ?`,
      [resumeState, conversation.contact_id]
    );
    await conn.commit();
    await addConversationEvent(pool, {
      conversationId,
      eventType: "RETURNED_TO_BOT",
      actorUserId,
      actorName,
      actorRole,
      detail: `${actorName} devolvió la conversación al bot. El cliente permanece asignado a la misma asesora.`,
      metadata: {
        assignment_preserved: true,
        assigned_agent_id: Number(conversation.assigned_agent_id || actorUserId),
        assigned_agent_name: conversation.assigned_agent_name || actorName,
      },
    });
    return await getConversationById(pool, conversationId);
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally { conn.release(); }
}

export async function closeConversation(pool, { conversationId, actorUserId, actorName, actorRole }) {
  if (actorRole !== "Administrador") throw Object.assign(new Error("Solo el administrador puede cerrar conversaciones."), { code: "ADMIN_ONLY" });
  const conversation = await getConversationById(pool, conversationId);
  if (!conversation) throw Object.assign(new Error("Conversación no encontrada."), { code: "CONVERSATION_NOT_FOUND" });
  await pool.execute(
    `UPDATE bot_conversations SET status = 'CLOSED', mode = 'BOT', assigned_agent_id = NULL,
        assigned_agent_name = NULL, closed_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [conversationId]
  );
  await pool.execute(
    `UPDATE bot_sessions SET state = 'CONVERSACION_CERRADA', human_handoff = 0, updated_at = NOW() WHERE contact_id = ?`,
    [conversation.contact_id]
  );
  await addConversationEvent(pool, {
    conversationId,
    eventType: "CLOSED",
    actorUserId,
    actorName,
    actorRole,
    detail: `${actorName} cerró la conversación. El historial se conserva íntegro.`,
  });
  return await getConversationById(pool, conversationId);
}

// =========================================================
// V3 - PERFILAMIENTO ESTRUCTURADO VISA USA
// =========================================================

function _profileAnswerMap(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(String(row.question_key), row);
  return map;
}

function _rowValue(map, key) {
  const row = map.get(key);
  return row ? String(row.answer_value ?? "").trim() : "";
}

function _safeJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value).split(/[,\n;]+/).map((v) => v.trim()).filter(Boolean);
  }
}

function _applicantNumberKeys(map, prefix) {
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  return [...map.keys()]
    .map((key) => {
      const match = re.exec(key);
      return match ? Number.parseInt(match[1], 10) : null;
    })
    .filter(Number.isInteger);
}

export async function syncStructuredVisaProfile(pool, { contactId, serviceCode, waId }) {
  if (!["01_VISA_USA_PRIMERA_VEZ", "02_VISA_USA_RENOVACION"].includes(serviceCode)) return;

  try {
    const rows = await getProfileAnswers(pool, contactId, serviceCode);
    const map = _profileAnswerMap(rows);
    const ages = _safeJsonArray(_rowValue(map, "EDADES_SOLICITANTES")).map((v) => Number(v));
    const count = Number.parseInt(_rowValue(map, "NUMERO_SOLICITANTES"), 10) || ages.length || 0;
    const previous = _rowValue(map, "VISA_AMERICANA_ANTERIOR");
    const reviewFirstRenewal = ["SI", "NO_SEGURO"].includes(previous) ? 1 : 0;

    const riskyRenewal = [...map.keys()].some((key) => {
      if (!/^ESTATUS_VISA_ANTERIOR_\d+$/.test(key)) return false;
      return ["ROBADA_EXTRAVIADA", "CANCELADA_REVOCADA", "OTRO"].includes(_rowValue(map, key));
    });

    const reviewReason = [
      reviewFirstRenewal ? "Revisar Primera Vez o Renovación" : null,
      riskyRenewal ? "Situación especial de visa anterior" : null,
    ].filter(Boolean).join(" | ") || null;

    await pool.execute(
      `INSERT INTO bot_prospect_profiles
       (contact_id, service_code, servicio_interes, numero_solicitantes, edades_solicitantes_json,
        motivo_viaje, motivo_viaje_otro, pasaporte_vigente, solicitantes_con_pasaporte,
        quiere_pasaporte_mexicano, visa_americana_anterior, revisar_primera_vez_renovacion,
        ciudad_estado, origen_prospecto, recomendado_por, ubicacion_volante, origen_prospecto_otro,
        fecha_primer_contacto, telefono_whatsapp, requiere_revision_asesora, revision_reason,
        created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, bc.first_contact_at, ?, ?, ?, NOW(), NOW()
         FROM bot_contacts bc WHERE bc.id = ?
       ON DUPLICATE KEY UPDATE
        servicio_interes = VALUES(servicio_interes),
        numero_solicitantes = VALUES(numero_solicitantes),
        edades_solicitantes_json = VALUES(edades_solicitantes_json),
        motivo_viaje = VALUES(motivo_viaje),
        motivo_viaje_otro = VALUES(motivo_viaje_otro),
        pasaporte_vigente = VALUES(pasaporte_vigente),
        solicitantes_con_pasaporte = VALUES(solicitantes_con_pasaporte),
        quiere_pasaporte_mexicano = VALUES(quiere_pasaporte_mexicano),
        visa_americana_anterior = VALUES(visa_americana_anterior),
        revisar_primera_vez_renovacion = VALUES(revisar_primera_vez_renovacion),
        ciudad_estado = VALUES(ciudad_estado),
        origen_prospecto = VALUES(origen_prospecto),
        recomendado_por = VALUES(recomendado_por),
        ubicacion_volante = VALUES(ubicacion_volante),
        origen_prospecto_otro = VALUES(origen_prospecto_otro),
        telefono_whatsapp = VALUES(telefono_whatsapp),
        requiere_revision_asesora = VALUES(requiere_revision_asesora),
        revision_reason = VALUES(revision_reason),
        updated_at = NOW()`,
      [
        contactId, serviceCode, serviceCode, count || null, JSON.stringify(ages),
        _rowValue(map, "MOTIVO_VIAJE") || null,
        _rowValue(map, "MOTIVO_VIAJE_OTRO") || null,
        _rowValue(map, "PASAPORTE_VIGENTE") || null,
        Number.parseInt(_rowValue(map, "SOLICITANTES_CON_PASAPORTE"), 10) || null,
        _rowValue(map, "QUIERE_PASAPORTE_MEXICANO") || null,
        previous || null,
        reviewFirstRenewal,
        _rowValue(map, "CIUDAD_ESTADO") || null,
        _rowValue(map, "ORIGEN_PROSPECTO") || null,
        _rowValue(map, "RECOMENDADO_POR") || null,
        _rowValue(map, "UBICACION_VOLANTE") || null,
        _rowValue(map, "ORIGEN_PROSPECTO_OTRO") || null,
        waId || null,
        reviewFirstRenewal || riskyRenewal ? 1 : 0,
        reviewReason,
        contactId,
      ]
    );

    const [profileRows] = await pool.execute(
      `SELECT id FROM bot_prospect_profiles WHERE contact_id = ? AND service_code = ? LIMIT 1`,
      [contactId, serviceCode]
    );
    const profileId = profileRows[0]?.id;
    if (!profileId || !count) return;

    for (let i = 1; i <= count; i += 1) {
      const visaStatus = _rowValue(map, `ESTATUS_VISA_ANTERIOR_${i}`) || null;
      const needsReview = ["ROBADA_EXTRAVIADA", "CANCELADA_REVOCADA", "OTRO"].includes(visaStatus) ? 1 : 0;
      await pool.execute(
        `INSERT INTO bot_profile_applicants
         (profile_id, applicant_number, age, occupation, previous_visa_status,
          visa_expiry_text, previous_visa_grant_age_text, needs_advisor_review, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
          age = VALUES(age),
          occupation = VALUES(occupation),
          previous_visa_status = VALUES(previous_visa_status),
          visa_expiry_text = VALUES(visa_expiry_text),
          previous_visa_grant_age_text = VALUES(previous_visa_grant_age_text),
          needs_advisor_review = VALUES(needs_advisor_review),
          updated_at = NOW()`,
        [
          profileId,
          i,
          Number.isFinite(ages[i - 1]) ? ages[i - 1] : null,
          _rowValue(map, `OCUPACION_SOLICITANTE_${i}`) || null,
          visaStatus,
          _rowValue(map, `FECHA_VENCIMIENTO_VISA_${i}`) || null,
          _rowValue(map, `EDAD_AL_OTORGAMIENTO_VISA_ANTERIOR_${i}`) || null,
          needsReview,
        ]
      );
    }
  } catch (error) {
    // La migración SQL se entrega junto al código. Si aún no se ha ejecutado,
    // el bot conserva bot_profile_answers y no rompe el flujo.
    if (error?.code === "ER_NO_SUCH_TABLE") return;
    throw error;
  }
}

// =========================================================
// V3.1 - DECISIÓN COMERCIAL DEL PROSPECTO
// =========================================================

export async function setCommercialInterest(pool, { contactId, decision }) {
  const normalized = String(decision || "").toUpperCase() === "SI" ? "SI" : "NO";
  try {
    await pool.execute(
      `UPDATE bot_prospect_profiles
          SET interes_continuar = ?, interes_continuar_at = NOW(), updated_at = NOW()
        WHERE contact_id = ?`,
      [normalized, contactId]
    );
  } catch (error) {
    // Permite desplegar el código aunque la migración V3.1 aún no se haya ejecutado.
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return;
    throw error;
  }
}

export async function closeCommercialConversation(pool, { contactId, conversationId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE bot_sessions
          SET state = 'CONVERSACION_CERRADA', human_handoff = 0, updated_at = NOW()
        WHERE contact_id = ?`,
      [contactId]
    );

    await conn.execute(
      `UPDATE bot_conversations
          SET mode = 'BOT', status = 'CLOSED',
              assigned_agent_id = NULL, assigned_agent_name = NULL,
              handoff_reason = NULL, handoff_requested_at = NULL,
              handoff_taken_at = NULL, closed_at = NOW(), updated_at = NOW()
        WHERE id = ? AND contact_id = ?`,
      [conversationId, contactId]
    );

    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally {
    conn.release();
  }
}
