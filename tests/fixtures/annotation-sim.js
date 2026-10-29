// Reduced Ant Design cascader + platform-like Space submit for the annotation fixture.
// Not NOVA. Opens on the mousedown+mouseup+click sequence Utils.clickEl sends,
// renders hierarchical path keys, and counts a submit only when the platform
// handler accepts a Space keydown.
(function () {
  'use strict';

  var SPLIT = '__RC_CASCADER_SPLIT__';
  var LEAVES = [
    'Grammar',
    'Authenticity',
    'Unauthentic Vocabulary / Collocations',
    'Fluency',
    'Accuracy',
    'Omission',
    'Addition',
    'Terminology',
    'Register',
    'Other',
  ];

  window.__fixture = {
    submitCount: 0,
    spaceEvents: [],
    lastSubmit: null,
    failNextLeaf: false,
  };

  function pathKeyOf(li) {
    return li.getAttribute('data-path-key');
  }

  function selectionItem(selector) {
    var item = selector.querySelector('.ant-select-selection-item');
    if (!item) {
      item = document.createElement('span');
      item.className = 'ant-select-selection-item';
      item.setAttribute('title', '');
      selector.appendChild(item);
    }
    return item;
  }

  function setDisplayed(root, value) {
    var selector = root.querySelector('.ant-select-selector');
    var placeholder = selector.querySelector('.ant-select-selection-placeholder');
    var item = selectionItem(selector);
    if (value) {
      item.textContent = value;
      item.setAttribute('title', value);
      if (placeholder) placeholder.style.display = 'none';
      root.classList.add('ant-select-has-value');
    } else {
      item.textContent = '';
      item.removeAttribute('title');
      if (placeholder) placeholder.style.display = '';
      root.classList.remove('ant-select-has-value');
    }
  }

  function ensureClear(root) {
    var clear = root.querySelector('.ant-select-clear');
    if (!clear) {
      clear = document.createElement('span');
      clear.className = 'ant-select-clear';
      clear.setAttribute('unselectable', 'on');
      clear.setAttribute('aria-hidden', 'true');
      clear.textContent = '×';
      root.appendChild(clear);
    }
    clear.style.display = root.querySelector('.ant-select-selection-item')
      && root.querySelector('.ant-select-selection-item').textContent.trim()
      ? ''
      : 'none';
  }

  function menuItem(label, pathKey, expandable) {
    var li = document.createElement('li');
    li.className = 'ant-cascader-menu-item' + (expandable ? ' ant-cascader-menu-item-expand' : '');
    li.setAttribute('data-path-key', pathKey);
    li.setAttribute('role', 'menuitemcheckbox');
    var content = document.createElement('div');
    content.className = 'ant-cascader-menu-item-content';
    content.textContent = label;
    li.appendChild(content);
    if (expandable) {
      var arrow = document.createElement('span');
      arrow.className = 'ant-cascader-menu-item-expand-icon';
      arrow.textContent = '>';
      li.appendChild(arrow);
    }
    return li;
  }

  function column(items) {
    var ul = document.createElement('ul');
    ul.className = 'ant-cascader-menu';
    ul.setAttribute('role', 'menu');
    items.forEach(function (item) { ul.appendChild(item); });
    return ul;
  }

  function rootColumn() {
    return column([
      menuItem('3 Points', '3 Points', false),
      menuItem('2 Points', '2 Points', true),
      menuItem('Confusing', 'Confusing', false),
    ]);
  }

  function categoryColumn() {
    var prefix = '2 Points' + SPLIT;
    return column(LEAVES.map(function (label, index) {
      // First category drills one level deeper so tests can tell a category
      // click from a terminal leaf. The rest are leaves (keys 2-9 and 0).
      // Display text stays the label; data-path-key is the hierarchy path.
      return menuItem(label, prefix + label, index === 0);
    }));
  }

  function leafColumn() {
    var key = '2 Points' + SPLIT + 'Grammar' + SPLIT + 'Grammar';
    return column([menuItem('Grammar', key, false)]);
  }

  function displayFromKey(pathKey, previous) {
    if (pathKey === '3 Points' || pathKey === 'Confusing' || pathKey === '2 Points') return pathKey;
    var parts = pathKey.split(SPLIT);
    if (parts[0] !== '2 Points') return previous ? previous + ' / ' + pathKey : pathKey;
    return parts.join(' / ');
  }

  function dropdownFor(root) {
    var existing = root.querySelector('.ant-select-dropdown');
    if (existing) return existing;
    var input = root.querySelector('input');
    var drop = document.createElement('div');
    drop.className = 'ant-select-dropdown ant-cascader-dropdown labels-cascader-with-hidden-checkbox nova-cascader-popup';
    drop.style.display = 'none';
    if (input && input.id) drop.id = input.id + '_list';
    var menus = document.createElement('div');
    menus.className = 'ant-cascader-menus';
    menus.appendChild(rootColumn());
    drop.appendChild(menus);
    root.appendChild(drop);
    return drop;
  }

  function openDropdown(root) {
    document.querySelectorAll('.ant-select').forEach(function (other) {
      if (other !== root) closeDropdown(other);
    });
    var drop = dropdownFor(root);
    var menus = drop.querySelector('.ant-cascader-menus');
    menus.textContent = '';
    menus.appendChild(rootColumn());
    drop.style.display = 'block';
    var input = root.querySelector('input');
    if (input) {
      input.setAttribute('aria-expanded', 'true');
      input.focus();
    }
    root.classList.add('ant-select-open');
  }

  function closeDropdown(root) {
    var drop = root.querySelector('.ant-select-dropdown');
    if (drop) drop.style.display = 'none';
    var input = root.querySelector('input');
    if (input) input.setAttribute('aria-expanded', 'false');
    root.classList.remove('ant-select-open');
  }

  function showNextColumn(drop, builder) {
    var menus = drop.querySelector('.ant-cascader-menus');
    var cols = menus.querySelectorAll('ul.ant-cascader-menu');
    while (cols.length > 1) {
      cols[cols.length - 1].remove();
      cols = menus.querySelectorAll('ul.ant-cascader-menu');
    }
    menus.appendChild(builder());
  }

  function onItemClick(event) {
    var li = event.target.closest && event.target.closest('li.ant-cascader-menu-item');
    if (!li) return;
    var root = li.closest('.ant-select');
    var drop = li.closest('.ant-select-dropdown');
    var key = pathKeyOf(li);
    var current = root.querySelector('.ant-select-selection-item');
    var previous = current ? current.textContent.trim() : '';

    if (li.classList.contains('ant-cascader-menu-item-expand')) {
      if (key === '2 Points') {
        // Re-opening the label flow resets a deeper value back to bare
        // "2 Points" so a failed leaf click cannot look like a completed label.
        setDisplayed(root, '2 Points');
        showNextColumn(drop, categoryColumn);
      } else {
        showNextColumn(drop, leafColumn);
      }
      ensureClear(root);
      return;
    }

    // Test-only: swallow the next label-leaf click, as if the platform
    // ignored it. The displayed value and the open popup are left as is.
    if (window.__fixture.failNextLeaf && key.indexOf(SPLIT) >= 0) {
      window.__fixture.failNextLeaf = false;
      return;
    }

    setDisplayed(root, displayFromKey(key, previous));
    ensureClear(root);
    closeDropdown(root);
  }

  // Utils.clickEl dispatches mousedown, mouseup, then click, each aimed at
  // the element's center. mousedown on a selector hits the input or
  // placeholder and bubbles through .ant-select-selector. Focusing that
  // input makes the later mouseup/click land outside the selector, so a
  // click-only listener never sees the rest of the gesture. Handle all
  // three events. Once a mousedown has toggled the control, mouseup/click
  // from that same gesture must not toggle it back.
  function bindClickEl(el, onGesture) {
    var fromMouseDown = false;
    el.addEventListener('mousedown', function (event) {
      fromMouseDown = true;
      onGesture(event);
    });
    function finish(event) {
      if (fromMouseDown) {
        if (event.type === 'click') fromMouseDown = false;
        return;
      }
      onGesture(event);
    }
    el.addEventListener('mouseup', finish);
    el.addEventListener('click', finish);
  }

  function wireCascader(root) {
    var selector = root.querySelector('.ant-select-selector');
    if (!selector) return;
    dropdownFor(root);
    bindClickEl(selector, function () {
      var input = root.querySelector('input');
      if (input && input.getAttribute('aria-expanded') === 'true') closeDropdown(root);
      else openDropdown(root);
    });
    bindClickEl(root, function (event) {
      if (event.target.closest && event.target.closest('.ant-select-selector')) return;
      if (event.target.closest && event.target.closest('.ant-select-clear')) {
        event.preventDefault();
        setDisplayed(root, '');
        closeDropdown(root);
        ensureClear(root);
        return;
      }
      if (event.target.closest && event.target.closest('li.ant-cascader-menu-item')) onItemClick(event);
    });
    ensureClear(root);
  }

  function isSpace(event) {
    return event.key === ' ' || event.code === 'Space' || event.keyCode === 32;
  }

  function recordSpace(event, accepted) {
    window.__fixture.spaceEvents.push({
      type: event.type,
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      which: event.which,
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      defaultPrevented: event.defaultPrevented,
      trusted: event.isTrusted,
      target: event.target && event.target.nodeName,
      accepted: accepted,
    });
  }

  // ASSUMPTION (see README): the platform's real hotkey listener is not in the
  // capture. This models a common one: a window-level bubbling keydown that
  // ignores text-entry targets, as hotkey libraries usually do.
  function isTextEntryTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    var tag = target.nodeName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
  }

  function onSpace(event) {
    if (!isSpace(event)) return;
    var accepted = event.type === 'keydown'
      && event.bubbles
      && !event.defaultPrevented
      && event.key === ' '
      && event.code === 'Space'
      && !isTextEntryTarget(event.target);
    recordSpace(event, accepted);
    if (!accepted) return;
    window.__fixture.submitCount += 1;
    window.__fixture.lastSubmit = {
      type: event.type,
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      target: event.target && event.target.nodeName,
    };
  }

  document.querySelectorAll('[data-module-name$=" Score"] .ant-select').forEach(wireCascader);
  window.addEventListener('keydown', onSpace, false);
  window.addEventListener('keyup', onSpace, false);

  var submit = document.getElementById('fx-submit');
  if (submit) {
    submit.addEventListener('click', function () {
      window.__fixture.submitCount += 1;
      window.__fixture.lastSubmit = { type: 'click', target: 'BUTTON' };
    });
  }
})();
