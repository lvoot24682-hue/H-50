// check-wolf.js
// يقرأ الرموز من anaayaar-ops/too عبر session-loader.js

import wolfjs from 'wolf.js';
import { io } from 'socket.io-client';

import {
    loadSession,
    closeSessionBrowser
} from './session-loader.js';

const { WOLF, OnlineState } = wolfjs;

// ==================== ⚙️ البيانات الثابتة ====================
const settings = {
    targetBotId: 45578849,
    actionWord: "!بطل 5",
    delayBetweenHeists: 11000,      // 11 ثانية فاصل بين الصيد
    workDuration: 54 * 60 * 1000,   // 54 دقيقة عمل
    restDuration: 6 * 60 * 1000     // 6 دقائق راحة
};
// =============================================================

// ============================================================
// متغيرات الاتصال
// ============================================================

let service = null;
let socket = null;
let browserClosed = false;

let heistQueue = [];
let isProcessing = false;
let isResting = false;

let shuttingDown = false;

// ============================================================
// أدوات مساعدة
// ============================================================

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// إغلاق آمن
// ============================================================

async function shutdown(code = 0) {

    if (shuttingDown) return;
    shuttingDown = true;

    console.log('');
    console.log('========================================');
    console.log('🛑 جاري إنهاء التشغيل...');
    console.log('========================================');

    // إيقاف Socket.IO
    try {
        if (socket) socket.disconnect();
    } catch {}

    try {
        if (service?.websocket?.socket) {
            service.websocket.socket.disconnect();
        }
    } catch {}

    // لا يوجد متصفح لإغلاقه
    try {
        if (!browserClosed) {
            browserClosed = true;
            await closeSessionBrowser();
        }
    } catch (err) {
        console.log('⚠️ تعذر إغلاق الجلسة:', err?.message || err);
    }

    console.log(`🏁 انتهى البرنامج — Code ${code}`);

    process.exitCode = code;
    setTimeout(() => process.exit(code), 1500).unref();
}

// ============================================================
// انتظار Authorization
// ============================================================

async function waitForSubscriber(timeoutMs = 60000) {

    const started = Date.now();

    console.log('⏳ انتظار Authorization...');

    while (Date.now() - started < timeoutMs) {

        if (service?.currentSubscriber?.id) {

            console.log('');
            console.log('========================================');
            console.log('✅ Authorization complete');
            console.log('========================================');

            console.log(
                `👤 الحساب: ${
                    service.currentSubscriber.username ||
                    service.currentSubscriber.nickname ||
                    'غير معروف'
                }`
            );

            console.log(`🆔 ID: ${service.currentSubscriber.id}`);

            return true;
        }

        await sleep(500);
    }

    return false;
}

// ============================================================
// تهيئة WOLF Handlers
// ============================================================

async function initializeHandlers() {

    console.log('⚙️ تهيئة WOLF handlers...');

    await service.websocket.init();

    const count = Object.keys(
        service.websocket.handlers || {}
    ).length;

    console.log(`⚙️ تم تحميل ${count} handlers`);
}

// ============================================================
// الاتصال باستخدام رموز GitHub
// ============================================================

async function connectUsingGitHubTokens(credentials) {

    const token = credentials?.token;
    const appCheckToken = credentials?.appCheckToken || '';
    const deviceToken = credentials?.deviceToken || '';
    const device = credentials?.device || 'web';

    const isAppCheckEnabled = Boolean(
        credentials?.isAppCheckEnabled ?? appCheckToken
    );

    if (!token) {
        throw new Error('لم يتم العثور على v3APIToken في tokens.json');
    }

    console.log('');
    console.log('========================================');
    console.log('🔐 بيانات الجلسة');
    console.log('========================================');

    console.log(`🔐 WOLF Token length: ${token.length}`);

    console.log(
        appCheckToken
            ? `🛡️ AppCheck length: ${appCheckToken.length}`
            : '⚠️ AppCheck Token غير موجود'
    );

    if (deviceToken) {
        console.log(`📱 DeviceToken length: ${deviceToken.length}`);
    }

    console.log(`📱 Device: ${device}`);

    console.log(
        `🛡️ App Check: ${
            isAppCheckEnabled ? 'enabled' : 'disabled'
        }`
    );

    console.log('========================================');

    // ========================================================
    // إنشاء WOLF
    // ========================================================

    service = new WOLF();

    service.config.framework.login.token = token;
    service.config.framework.login.onlineState = OnlineState.BUSY;

    if (appCheckToken) {
        service.config.framework.login.appCheckToken = appCheckToken;
    }

    // ========================================================
    // تهيئة Handlers
    // ========================================================

    await initializeHandlers();

    // ========================================================
    // إعداد الاتصال
    // ========================================================

    const connection =
        service._frameworkConfig?.get?.('connection');

    const host =
        connection?.host || 'https://v3-rc.palringo.com';

    const port = connection?.port ?? 443;

    const connectionDevice =
        connection?.query?.device || device || 'web';

    console.log('');
    console.log('========================================');
    console.log('🔌 بدء اتصال WOLF');
    console.log('========================================');

    console.log(`🌐 Host: ${host}`);
    console.log(`🔌 Port: ${port}`);
    console.log(`📱 Device: ${connectionDevice}`);

    // ========================================================
    // Socket.IO
    // ========================================================

    socket = io(
        `${host}:${port}`,
        {
            transports: ['websocket'],

            reconnection: true,
            reconnectionDelay: 5000,
            reconnectionAttempts: Infinity,

            autoConnect: false,

            query: {
                token,

                device: connectionDevice,

                state: service.config.framework.login.onlineState,

                version: connection?.version || undefined,

                isAppCheckEnabled:
                    isAppCheckEnabled ? 'true' : 'false',

                appCheckToken:
                    isAppCheckEnabled ? appCheckToken : undefined,

                deviceToken:
                    deviceToken || undefined
            }
        }
    );

    service.websocket.socket = socket;

    // ========================================================
    // Connected
    // ========================================================

    socket.on('connect', () => {
        console.log('');
        console.log('========================================');
        console.log('🔗 تم الاتصال بـ WOLF Socket.IO');
        console.log(`🔗 Connection ID: ${socket.id}`);
        console.log('========================================');
    });

    // ========================================================
    // Connection error
    // ========================================================

    socket.on('connect_error', error => {
        console.error(
            '❌ Connection error:',
            error?.message || error
        );
    });

    // ========================================================
    // Disconnect
    // ========================================================

    socket.on('disconnect', reason => {
        console.log(`🔌 Connection closed: ${reason}`);
    });

    // ========================================================
    // تمرير أحداث WOLF إلى Handlers
    // ========================================================

    socket.onAny(async (eventName, data) => {

        try {

            if (eventName === 'group event update') {
                return;
            }

            const handler =
                service.websocket.handlers?.[eventName];

            if (!handler) {
                return;
            }

            await handler.process(data?.body ?? data);

        } catch (error) {

            console.error(
                `❌ Handler error [${eventName}]:`,
                error?.message || error
            );
        }
    });

    // ========================================================
    // الاتصال
    // ========================================================

    console.log('🔌 Connecting...');

    socket.connect();

    // ========================================================
    // انتظار Authorization
    // ========================================================

    const ready = await waitForSubscriber(60000);

    if (!ready) {
        throw new Error('WOLF اتصل لكن Authorization لم يكتمل.');
    }

    console.log('');
    console.log('🟢 WOLF جاهز لمراقبة الرسائل.');
}

// ============================================================
// معالجة طابور الصيد
// ============================================================

const processQueue = async () => {

    if (isProcessing || heistQueue.length === 0 || isResting) return;

    isProcessing = true;

    while (heistQueue.length > 0 && !isResting) {

        const roomId = heistQueue.shift();

        console.log(`⏳ انتظار الاستراحة بين الصيد... الروم: ${roomId}`);

        await sleep(settings.delayBetweenHeists);

        if (isResting) {
            heistQueue.unshift(roomId);
            break;
        }

        try {

            // نظام فحص إصدار المكتبة للانضمام للروم
            if (service.groups && typeof service.groups.join === 'function') {
                await service.groups.join(roomId).catch(() => {});
            } else if (service.group && typeof service.group.join === 'function') {
                await service.group.join(roomId).catch(() => {});
            } else if (typeof service.joinGroup === 'function') {
                await service.joinGroup(roomId).catch(() => {});
            }

            // إرسال رسالة الصيد
            await service.messaging.sendGroupMessage(
                roomId,
                settings.actionWord
            );

            console.log(
                `🚀 [${new Date().toLocaleTimeString('ar-SA')}] تم الصيد في [${roomId}]. المتبقي في الطابور: ${heistQueue.length}`
            );

        } catch (err) {

            console.error(
                `❌ فشل الصيد في الروم ${roomId}: ${err.message}`
            );
        }
    }

    isProcessing = false;
};

// ============================================================
// نظام إدارة الوقت (54/6)
// ============================================================

const manageWorkCycle = async () => {

    while (!shuttingDown) {

        console.log("🟢 [نظام الوقت] بدأت دورة الـ 54 دقيقة عمل.");

        isResting = false;
        processQueue();

        await sleep(settings.workDuration);

        if (shuttingDown) break;

        console.log("🛑 [نظام الوقت] بدأت دورة الـ 6 دقائق راحة. يتوقف الصيد مؤقتاً.");

        isResting = true;

        await sleep(settings.restDuration);
    }
};

// ============================================================
// مراقبة الرسائل الخاصة من البوت المستهدف
// ============================================================

function attachMessageListener() {

    service.on('message', async (message) => {

        // التقاط رسائل الصيد من البوت المستهدف
        if (
            !message.isGroup &&
            (
                message.sourceSubscriberId === settings.targetBotId ||
                message.authorId === settings.targetBotId
            )
        ) {

            const content =
                message.body || message.content || "";

            // المحاولة الأولى: البحث بالطريقة الإنجليزية (ID + رقم)
            let match = content.match(/\(ID\s*(\d+)\)/);

            // إذا لم يجد شيئاً، المحاولة الثانية: البحث بالطريقة العربية
            if (!match) {
                match = content.match(/\[.*?\]\s*\(\s*[\s\u200B]*(\d+)/);
            }

            if (match && match[1]) {

                const roomId = parseInt(match[1]);

                console.log(`📥 إضافة الروم ${roomId} إلى الطابور...`);

                heistQueue.push(roomId);

                if (!isResting) {
                    processQueue();
                } else {
                    console.log(
                        `⏳ استراحة حالياً. سيتم معالجة الروم ${roomId} فور العودة للعمل.`
                    );
                }
            }
        }
    });
}

// ============================================================
// Heartbeat للتأكد من الاتصال
// ============================================================

function startHeartbeat() {

    setInterval(() => {

        if (shuttingDown) return;

        const connected = socket?.connected;

        console.log(
            `💓 Heartbeat | socket=${connected ? 'ON' : 'OFF'} | ${new Date().toISOString()} | queue=${heistQueue.length}`
        );

        if (!connected && socket) {
            try { socket.connect(); } catch {}
        }

    }, 60 * 1000).unref();
}

// ============================================================
// البرنامج الرئيسي
// ============================================================

async function main() {

    console.log('');
    console.log('========================================');
    console.log('🐺 WOLF Heist Watcher');
    console.log('🐺 wolf.js 2.7.10');
    console.log('📦 Tokens from: anaayaar-ops/too');
    console.log('========================================');
    console.log('');

    try {

        // ====================================================
        // 1. قراءة الرموز من GitHub
        // ====================================================

        console.log('🌐 قراءة الرموز من GitHub (too)...');

        const credentials = await loadSession();

        if (!credentials?.token) {
            throw new Error('لم يتم العثور على v3APIToken في tokens.json');
        }

        console.log('✅ تم العثور على v3APIToken');

        if (credentials.appCheckToken) {
            console.log(
                `🛡️ AppCheck length: ${credentials.appCheckToken.length}`
            );
            console.log('✅ تم العثور على App Check Token');
        } else {
            console.log('⚠️ لا يوجد App Check Token');
        }

        if (credentials.deviceToken) {
            console.log(
                `📱 DeviceToken length: ${credentials.deviceToken.length}`
            );
        }

        console.log(
            `📱 Device: ${credentials.device || 'web'}`
        );

        // ====================================================
        // 2. الاتصال باستخدام الرموز
        // ====================================================

        await connectUsingGitHubTokens(credentials);

        // ====================================================
        // 3. تفعيل مراقبة الرسائل الخاصة
        // ====================================================

        attachMessageListener();

        console.log(
            `👂 جاري مراقبة رسائل البوت المستهدف (${settings.targetBotId})...`
        );

        // ====================================================
        // 4. بدء دورة العمل/الراحة (54/6)
        // ====================================================

        manageWorkCycle();

        // ====================================================
        // 5. Heartbeat
        // ====================================================

        startHeartbeat();

        // ====================================================
        // 6. إغلاق تلقائي قبل انتهاء الـ workflow
        // ====================================================

        const AUTO_SHUTDOWN_MS = (4 * 60 + 55) * 60 * 1000; // 4:55

        setTimeout(() => {
            console.log('⏰ انتهت مدة التشغيل التلقائي — إغلاق سلس');
            shutdown(0);
        }, AUTO_SHUTDOWN_MS).unref();

        console.log('');
        console.log('✅ البوت يعمل الآن — سيغلق تلقائياً بعد 4:55');

    } catch (err) {

        console.error('');
        console.error('========================================');
        console.error('❌ حصل خطأ');
        console.error('========================================');

        console.error(err?.stack || err?.message || err);

        await shutdown(1);
    }
}

// ============================================================
// إيقاف
// ============================================================

process.on('SIGINT', async () => {
    await shutdown(0);
});

process.on('SIGTERM', async () => {
    await shutdown(0);
});

process.on('SIGHUP', async () => {
    await shutdown(0);
});

// معالجة الأخطاء غير المتوقعة
process.on('uncaughtException', err => {
    console.error('💥 UNCAUGHT EXCEPTION:', err?.stack || err);
});

process.on('unhandledRejection', err => {
    console.error('💥 UNHANDLED REJECTION:', err?.stack || err);
});

// ============================================================
// START
// ============================================================

main();
