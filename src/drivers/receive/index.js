
import { CONFIG, CONSTANTS, POST_MESSAGE_NAMES_LIST } from '../../conf';
import { getWindowById, registerWindow, deserializeMethods, log, getOpener, getWindowId, isWindowClosed, isSameDomain, util } from '../../lib';
import { emulateIERestrictions, registerBridge } from '../../compat';

import { sendMessage } from '../send';

import { RECEIVE_MESSAGE_TYPES } from './types';

let receivedMessages = [];

function parseMessage(message) {

    try {
        message = JSON.parse(message);
    } catch (err) {
        return;
    }

    if (!message.type) {
        return;
    }

    if (!RECEIVE_MESSAGE_TYPES[message.type]) {
        return;
    }

    return message;
}

function getWindow(hint, windowID) {

    let windowTargets = {
        'window.parent': id => window.parent,
        'window.opener': id => getOpener(window),
        'window.parent.opener': id => getOpener(window.parent),
        'window.opener.parent': id => getOpener(window).parent
    };

    let win;

    try {
        win = windowTargets[hint](windowID);
    } catch (err) {
        throw new Error(`Can not get ${hint}: ${err.message}`);
    }

    if (!win) {
        throw new Error(`Can not get ${hint}: not available`);
    }

    return win;
}

function getTargetWindow(source, message) {

    if (message.targetHint) {
        let win = getWindow(message.targetHint, message.target);
        delete message.targetHint;
        return win;
    }

    if (message.target && message.target !== getWindowId(window)) {

        let win = getWindowById(message.target);

        if (!win) {
            throw new Error(`Unable to find window to proxy message to: ${message.target}`);
        }

        return win;
    }
}


export function receiveMessage(event) {

    try {
        event.source // eslint-disable-line
    } catch (err) {
        return;
    }

    let { source, origin, data } = event;

    if (isSameDomain(source, false)) {
        origin = util.getDomain(source);
    }

    let message = parseMessage(data);

    if (!message) {
        return;
    }

    if (message.sourceDomain.indexOf('mock://') === 0) {
        origin = message.sourceDomain;
    }

    if (receivedMessages.indexOf(message.id) === -1) {
        receivedMessages.push(message.id);
    } else {
        return;
    }

    if (message.sourceDomain !== origin) {
        throw new Error(`Message source domain ${message.sourceDomain} does not match message origin ${origin}`);
    }

    registerWindow(message.source, source, origin);


    // Only allow self-certifying original domain when proxying through same domain

    if (message.originalSourceDomain !== origin) {
        if (!isSameDomain(source)) {
            throw new Error(`Message original source domain ${message.originalSourceDomain} does not match message origin ${origin}`);
        }
    }



    let targetWindow;

    try {
        targetWindow = getTargetWindow(source, message);
    } catch (err) {
        return log.debug(err.message);
    }

    let level;

    if (POST_MESSAGE_NAMES_LIST.indexOf(message.name) !== -1 || message.type === CONSTANTS.POST_MESSAGE_TYPE.ACK || targetWindow) {
        level = 'debug';
    } else if (message.ack === 'error') {
        level = 'error';
    } else {
        level = 'info';
    }

    log.logLevel(level, [ targetWindow ? '#receiveproxy' : '#receive', message.type, message.name, message ]);

    if (targetWindow) {

        if (isWindowClosed(targetWindow)) {
            return log.debug(`Target window is closed: ${message.target} - can not proxy ${message.type} ${message.name}`);
        }

        delete message.target;
        return sendMessage(targetWindow, message, message.domain || '*', true);
    }

    let originalSource = source;

    if (message.originalSource !== message.source) {

        if (message.sourceHint) {
            originalSource = getWindow(message.sourceHint, message.originalSource);
            delete message.sourceHint;
        } else {
            originalSource = getWindowById(message.originalSource);
            if (!originalSource) {
                throw new Error(`Can not find original message source: ${message.originalSource}`);
            }
        }

        registerWindow(message.originalSource, originalSource, message.originalSourceDomain);
    }

    if (originalSource !== source) {
        registerBridge(source, originalSource);
    }

    if (isWindowClosed(originalSource)) {
        return log.debug(`Source window is closed: ${message.originalSource} - can not send ${message.type} ${message.name}`);
    }

    if (CONFIG.MOCK_MODE) {
        return RECEIVE_MESSAGE_TYPES[message.type](originalSource, message, origin);
    }

    if (message.data) {
        message.data = deserializeMethods(originalSource, message.data);
    }

    RECEIVE_MESSAGE_TYPES[message.type](originalSource, message, origin);
}

export function messageListener(event) {

    try {
        event.source // eslint-disable-line
    } catch (err) {
        return;
    }

    event = {
        source: event.source || event.sourceElement,
        origin: event.origin || event.originalEvent.origin,
        data: event.data
    };

    try {
        emulateIERestrictions(event.source, window);
    } catch (err) {
        return;
    }

    receiveMessage(event);
}
