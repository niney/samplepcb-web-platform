-- ===== sp_pcb_partner_order =====
*************************** 1. row ***************************
sp_pcb_partner_order
CREATE TABLE `sp_pcb_partner_order` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '글 순번',
  `it_id` varchar(20) NOT NULL,
  `partner_mb_no` int(11) NOT NULL,
  `parent_mb_no` int(11) NOT NULL DEFAULT 0,
  `reorder_round` int(11) NOT NULL DEFAULT 0,
  `meta_item` longtext DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT '협력사 견적요청',
  `is_select_partner` tinyint(4) NOT NULL DEFAULT 0,
  `price` int(11) DEFAULT NULL,
  `selected_sub_partner_order_id` bigint(20) DEFAULT NULL,
  `margin_rate` int(11) DEFAULT NULL,
  `forwarder` varchar(30) DEFAULT NULL,
  `shipping` datetime DEFAULT NULL,
  `tracking` varchar(30) DEFAULT NULL,
  `estimate_file1_subj` varchar(50) DEFAULT NULL,
  `estimate_file1` varchar(150) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `suggested_delivery_date` date DEFAULT NULL,
  `quoted_delivery_date` date DEFAULT NULL,
  `write_date` datetime NOT NULL DEFAULT '0000-00-00 00:00:00' COMMENT '작성일',
  `modify_date` datetime NOT NULL DEFAULT '0000-00-00 00:00:00' COMMENT '수정일',
  `currency` varchar(3) NOT NULL DEFAULT 'KRW',
  `price_original` decimal(15,2) DEFAULT NULL,
  `exchange_rate` decimal(10,2) DEFAULT NULL,
  `sub_currency` varchar(3) DEFAULT NULL,
  `sub_price_original` decimal(15,2) DEFAULT NULL,
  `sub_exchange_rate` decimal(12,6) DEFAULT NULL,
  `source_currency` varchar(3) DEFAULT NULL,
  `source_amount` decimal(15,2) DEFAULT NULL,
  `source_rate` decimal(12,6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_pcb_partner_order_it_partner` (`it_id`,`partner_mb_no`,`parent_mb_no`,`reorder_round`),
  KEY `idx_sp_pcb_partner_order_mb_no` (`partner_mb_no`),
  KEY `idx_sp_pcb_po_parent` (`parent_mb_no`)
) ENGINE=MyISAM AUTO_INCREMENT=136 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci COMMENT='PCB 협력사 주문'
-- ===== sp_pcb_partner_order_document =====
*************************** 1. row ***************************
sp_pcb_partner_order_document
CREATE TABLE `sp_pcb_partner_order_document` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `it_id` varchar(20) NOT NULL,
  `mb_no` int(11) NOT NULL,
  `parent_mb_no` int(11) NOT NULL DEFAULT 0,
  `reorder_round` int(11) NOT NULL DEFAULT 0,
  `destination_country` varchar(2) DEFAULT NULL,
  `pcb_partner_order_id` bigint(20) DEFAULT NULL,
  `shipment_group_id` bigint(20) DEFAULT NULL,
  `shipment_id` bigint(20) DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT '발주접수',
  `order_price` int(11) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `delivery_date` datetime DEFAULT NULL,
  `payment_terms` varchar(50) DEFAULT NULL,
  `remitted_at` datetime DEFAULT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime NOT NULL,
  `eq_history_json` text DEFAULT NULL,
  `order_currency` varchar(3) NOT NULL DEFAULT 'KRW',
  `order_price_original` decimal(15,2) DEFAULT NULL,
  `order_exchange_rate` decimal(10,2) DEFAULT NULL,
  `order_sub_currency` varchar(3) DEFAULT NULL,
  `order_sub_price_original` decimal(15,2) DEFAULT NULL,
  `order_sub_exchange_rate` decimal(12,6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_pcb_pod` (`it_id`,`mb_no`,`parent_mb_no`,`reorder_round`),
  KEY `idx_sp_pcb_pod_mb` (`mb_no`),
  KEY `idx_sp_pcb_pod_parent` (`parent_mb_no`),
  KEY `idx_sp_pcb_pod_ship_group` (`shipment_group_id`),
  KEY `idx_sp_pcb_pod_ship` (`shipment_id`)
) ENGINE=MyISAM AUTO_INCREMENT=95 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_pcb_as_case =====
*************************** 1. row ***************************
sp_pcb_as_case
CREATE TABLE `sp_pcb_as_case` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `it_id` varchar(20) NOT NULL,
  `reorder_round` int(11) DEFAULT NULL,
  `case_type` varchar(20) NOT NULL,
  `charge_type` varchar(10) NOT NULL DEFAULT '유상',
  `description` text DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT '작성',
  `target_mb_no` int(11) NOT NULL,
  `parent_mb_no` int(11) NOT NULL DEFAULT 0,
  `reply_reason` text DEFAULT NULL,
  `created_mb_no` int(11) DEFAULT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_pcb_as_case` (`it_id`,`reorder_round`),
  KEY `idx_as_case_target` (`target_mb_no`),
  KEY `idx_as_case_parent` (`parent_mb_no`)
) ENGINE=MyISAM AUTO_INCREMENT=6 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_shipment =====
*************************** 1. row ***************************
sp_shipment
CREATE TABLE `sp_shipment` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `partner_order_document_id` bigint(20) DEFAULT NULL,
  `shipment_group_id` bigint(20) DEFAULT NULL,
  `order_type` varchar(10) NOT NULL DEFAULT 'BOM',
  `status` varchar(50) DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `carrier` varchar(50) DEFAULT NULL,
  `tracking_number` varchar(100) DEFAULT NULL,
  `tracking_url` varchar(500) DEFAULT NULL,
  `shipped_at` datetime DEFAULT NULL,
  `customs_cleared_at` datetime DEFAULT NULL,
  `arrived_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime NOT NULL,
  `ship_date` datetime DEFAULT NULL,
  `case_id` varchar(100) DEFAULT NULL,
  `case_id_required` tinyint(1) NOT NULL DEFAULT 0,
  `ship_qty` int(11) DEFAULT NULL,
  `last_updated_by` varchar(10) DEFAULT NULL,
  `history_json` text DEFAULT NULL,
  `invoice_data` text DEFAULT NULL,
  `shipment_mode` varchar(20) DEFAULT NULL,
  `domestic_country` varchar(2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sp_shipment_doc` (`partner_order_document_id`),
  KEY `idx_sp_shipment_type_doc` (`order_type`,`partner_order_document_id`),
  KEY `idx_sp_shipment_group` (`shipment_group_id`)
) ENGINE=MyISAM AUTO_INCREMENT=97 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_shipment_group =====
*************************** 1. row ***************************
sp_shipment_group
CREATE TABLE `sp_shipment_group` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `order_type` varchar(10) NOT NULL,
  `reorder_round` int(11) NOT NULL DEFAULT 0,
  `sender_mb_no` int(11) NOT NULL,
  `receiver_mb_no` int(11) NOT NULL,
  `destination_country` varchar(2) DEFAULT NULL,
  `title` varchar(200) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ssg_sender` (`order_type`,`sender_mb_no`),
  KEY `idx_ssg_receiver` (`order_type`,`receiver_mb_no`)
) ENGINE=MyISAM AUTO_INCREMENT=60 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_master_dealer_partner =====
*************************** 1. row ***************************
sp_master_dealer_partner
CREATE TABLE `sp_master_dealer_partner` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `master_dealer_mb_no` int(11) NOT NULL,
  `partner_mb_no` int(11) NOT NULL,
  `write_date` datetime NOT NULL,
  `settlement_currency` varchar(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_master_dealer_partner` (`master_dealer_mb_no`,`partner_mb_no`),
  KEY `idx_mdp_partner` (`partner_mb_no`)
) ENGINE=MyISAM AUTO_INCREMENT=4 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_estimate =====
*************************** 1. row ***************************
sp_estimate
CREATE TABLE `sp_estimate` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `mb_no` int(11) DEFAULT NULL,
  `it_id` varchar(20) NOT NULL,
  `category` varchar(30) NOT NULL,
  `currentSection` varchar(255) DEFAULT NULL,
  `currentIdx` int(11) DEFAULT NULL,
  `contents` longtext NOT NULL,
  `es_contents` longtext NOT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `mb_no` (`mb_no`),
  KEY `it_id` (`it_id`)
) ENGINE=MyISAM AUTO_INCREMENT=5294 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_estimate_item =====
*************************** 1. row ***************************
sp_estimate_item
CREATE TABLE `sp_estimate_item` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `estimate_document_id` bigint(20) NOT NULL,
  `pcb_part_doc_id` varchar(20) NOT NULL,
  `qty` int(11) DEFAULT NULL,
  `analysis_meta` text DEFAULT NULL,
  `selected_price` text DEFAULT NULL,
  `selected_partner_estimate_item_id` bigint(20) DEFAULT NULL,
  `order_partner_estimate_item_id` bigint(20) DEFAULT NULL,
  `order_selected_price` text DEFAULT NULL,
  `order_confirmed_price` text DEFAULT NULL,
  `confirmed_price` text DEFAULT NULL,
  `item_margin_rate` int(11) DEFAULT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sp_estimate_item_document_id` (`estimate_document_id`),
  KEY `idx_sp_estimate_item_pcb_part_doc_id` (`pcb_part_doc_id`),
  KEY `fk_sp_estimate_item_selected_partner` (`selected_partner_estimate_item_id`),
  KEY `fk_sp_estimate_item_order_partner` (`order_partner_estimate_item_id`)
) ENGINE=MyISAM AUTO_INCREMENT=1405 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_estimate_document =====
*************************** 1. row ***************************
sp_estimate_document
CREATE TABLE `sp_estimate_document` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `it_id` varchar(20) NOT NULL,
  `status` varchar(30) DEFAULT NULL,
  `expected_delivery` varchar(100) DEFAULT NULL,
  `shipping_fee` int(11) DEFAULT NULL,
  `management_fee` int(11) DEFAULT NULL,
  `total_amount` int(11) DEFAULT NULL,
  `final_amount` int(11) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `global_margin_rate` int(11) DEFAULT NULL,
  `set_quantity` int(11) DEFAULT NULL,
  `spare_quantity` int(11) DEFAULT NULL,
  `write_date` datetime DEFAULT NULL,
  `modify_date` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_estimate_document_it_id` (`it_id`)
) ENGINE=MyISAM AUTO_INCREMENT=75 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_partner_estimate_document =====
*************************** 1. row ***************************
sp_partner_estimate_document
CREATE TABLE `sp_partner_estimate_document` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `estimate_document_id` bigint(20) NOT NULL,
  `mb_no` int(11) NOT NULL,
  `parent_mb_no` int(11) NOT NULL DEFAULT 0,
  `status` varchar(30) DEFAULT '협력사 견적요청',
  `estimate_price` int(11) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `delivery_date` datetime DEFAULT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_partner_estimate_doc` (`estimate_document_id`,`mb_no`,`parent_mb_no`),
  KEY `fk_sp_partner_estimate_doc_member` (`mb_no`)
) ENGINE=MyISAM AUTO_INCREMENT=295 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_partner_estimate_item =====
*************************** 1. row ***************************
sp_partner_estimate_item
CREATE TABLE `sp_partner_estimate_item` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `estimate_item_id` bigint(20) NOT NULL,
  `partner_estimate_document_id` bigint(20) DEFAULT NULL,
  `mb_no` int(11) NOT NULL,
  `selected_price` text DEFAULT NULL,
  `selected_sub_partner_estimate_item_id` bigint(20) DEFAULT NULL,
  `margin_rate` int(11) DEFAULT NULL,
  `status` varchar(30) DEFAULT '협력사 견적요청',
  `memo` text DEFAULT NULL,
  `date_code` varchar(100) DEFAULT NULL,
  `delivery_date` datetime DEFAULT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime NOT NULL,
  `external_synced_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_partner_estimate_item` (`estimate_item_id`,`partner_estimate_document_id`),
  KEY `idx_sp_partner_estimate_item_estimate_item_id` (`estimate_item_id`),
  KEY `idx_sp_partner_estimate_item_mb_no` (`mb_no`),
  KEY `fk_sp_partner_estimate_item_partner_doc` (`partner_estimate_document_id`),
  KEY `fk_pei_selected_sub` (`selected_sub_partner_estimate_item_id`)
) ENGINE=MyISAM AUTO_INCREMENT=5067 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_partner_order =====
*************************** 1. row ***************************
sp_partner_order
CREATE TABLE `sp_partner_order` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '글 순번',
  `it_id` varchar(20) NOT NULL,
  `partner_mb_no` int(11) NOT NULL,
  `meta_item` longtext DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT '협력사 견적요청',
  `is_select_partner` tinyint(4) NOT NULL DEFAULT 0,
  `price` int(11) DEFAULT NULL,
  `forwarder` varchar(30) DEFAULT NULL,
  `shipping` datetime DEFAULT NULL,
  `tracking` varchar(30) DEFAULT NULL,
  `estimate_file1_subj` varchar(50) DEFAULT NULL,
  `estimate_file1` varchar(150) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `write_date` datetime NOT NULL DEFAULT '0000-00-00 00:00:00' COMMENT '작성일',
  `modify_date` datetime NOT NULL DEFAULT '0000-00-00 00:00:00' COMMENT '수정일',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_partner_order_it_partner` (`it_id`,`partner_mb_no`),
  KEY `fk_sp_partner_order_mb_no` (`partner_mb_no`)
) ENGINE=MyISAM AUTO_INCREMENT=414 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci COMMENT='협력사 주문'
-- ===== sp_partner_order_document =====
*************************** 1. row ***************************
sp_partner_order_document
CREATE TABLE `sp_partner_order_document` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `estimate_document_id` bigint(20) NOT NULL,
  `mb_no` int(11) NOT NULL,
  `parent_mb_no` int(11) NOT NULL DEFAULT 0,
  `status` varchar(30) DEFAULT NULL,
  `order_price` int(11) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `delivery_date` datetime DEFAULT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime NOT NULL,
  `payment_terms` varchar(50) DEFAULT NULL,
  `remitted_at` datetime DEFAULT NULL,
  `external_order_no` varchar(100) DEFAULT NULL,
  `external_cart_key` varchar(100) DEFAULT NULL,
  `external_order_status` varchar(30) DEFAULT NULL,
  `external_synced_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_partner_order_doc` (`estimate_document_id`,`mb_no`,`parent_mb_no`),
  KEY `fk_sp_partner_order_doc_member` (`mb_no`)
) ENGINE=MyISAM AUTO_INCREMENT=59 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_partner_order_item =====
*************************** 1. row ***************************
sp_partner_order_item
CREATE TABLE `sp_partner_order_item` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `estimate_item_id` bigint(20) NOT NULL,
  `partner_order_document_id` bigint(20) DEFAULT NULL,
  `mb_no` int(11) NOT NULL,
  `selected_price` text DEFAULT NULL,
  `selected_sub_order_item_id` bigint(20) DEFAULT NULL,
  `margin_rate` int(11) DEFAULT NULL,
  `status` varchar(30) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `write_date` datetime NOT NULL,
  `date_code` varchar(100) DEFAULT NULL,
  `delivery_date` datetime DEFAULT NULL,
  `modify_date` datetime NOT NULL,
  `shipment_id` bigint(20) DEFAULT NULL,
  `ship_qty` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_partner_order_item` (`estimate_item_id`,`partner_order_document_id`),
  KEY `fk_sp_partner_order_item_partner_doc` (`partner_order_document_id`),
  KEY `fk_sp_partner_order_item_member` (`mb_no`),
  KEY `idx_sp_partner_order_item_shipment` (`shipment_id`),
  KEY `fk_poi_selected_sub` (`selected_sub_order_item_id`)
) ENGINE=MyISAM AUTO_INCREMENT=214 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_total_estimate =====
*************************** 1. row ***************************
sp_total_estimate
CREATE TABLE `sp_total_estimate` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tot_id` varchar(20) NOT NULL,
  `tot_name` varchar(50) NOT NULL,
  `it_id` varchar(20) NOT NULL,
  `mb_no` int(11) NOT NULL,
  `write_date` datetime NOT NULL,
  `modify_date` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=504 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_outsourcing =====
*************************** 1. row ***************************
sp_outsourcing
CREATE TABLE `sp_outsourcing` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '타임라인 글 순번',
  `ct_id` int(11) NOT NULL,
  `od_id` bigint(20) unsigned NOT NULL,
  `mb_no` int(11) NOT NULL,
  `company_name` varchar(30) NOT NULL,
  `member_name` varchar(20) DEFAULT NULL,
  `member_tel` varchar(20) DEFAULT NULL,
  `member_mail` varchar(30) DEFAULT NULL,
  `meta_item` longtext DEFAULT NULL,
  `write_date` datetime NOT NULL DEFAULT '0000-00-00 00:00:00' COMMENT '작성일',
  `modify_date` datetime NOT NULL DEFAULT '0000-00-00 00:00:00' COMMENT '수정일',
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=8 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci COMMENT='외주'
-- ===== sp_partner_chat_0 =====
*************************** 1. row ***************************
sp_partner_chat_0
CREATE TABLE `sp_partner_chat_0` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `partner_order_id` bigint(20) NOT NULL,
  `it_id` varchar(20) NOT NULL,
  `stream_type` varchar(30) NOT NULL DEFAULT 'chat',
  `sender_id` int(11) NOT NULL,
  `receiver_id` int(11) NOT NULL,
  `contents` mediumtext NOT NULL,
  `file_id` int(11) DEFAULT NULL,
  `sender_status` tinyint(4) NOT NULL DEFAULT 0,
  `receiver_status` tinyint(4) NOT NULL DEFAULT 0,
  `write_date` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=49 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_pcb_parts =====
*************************** 1. row ***************************
sp_pcb_parts
CREATE TABLE `sp_pcb_parts` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `doc_id` varchar(20) NOT NULL,
  `write_date` datetime NOT NULL,
  `last_modified_date` datetime NOT NULL,
  `service_type` varchar(100) DEFAULT NULL,
  `sub_service_type` varchar(100) DEFAULT NULL,
  `large_category` varchar(255) DEFAULT NULL,
  `medium_category` varchar(255) DEFAULT NULL,
  `small_category` varchar(255) DEFAULT NULL,
  `part_name` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `manufacturer_name` varchar(255) DEFAULT NULL,
  `parts_packaging` varchar(255) DEFAULT NULL,
  `packaging` text DEFAULT NULL,
  `moq` int(11) DEFAULT NULL,
  `price` int(11) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `offer_name` varchar(255) DEFAULT NULL,
  `date_code` varchar(100) DEFAULT NULL,
  `member_id` varchar(255) DEFAULT NULL,
  `manager_phone_number` varchar(50) DEFAULT NULL,
  `manager_name` varchar(255) DEFAULT NULL,
  `manager_email` varchar(255) DEFAULT NULL,
  `contents` text DEFAULT NULL,
  `status` int(11) DEFAULT NULL,
  `watt` text DEFAULT NULL,
  `tolerance` text DEFAULT NULL,
  `ohm` text DEFAULT NULL,
  `condenser` text DEFAULT NULL,
  `voltage` text DEFAULT NULL,
  `temperature` varchar(255) DEFAULT NULL,
  `size` varchar(255) DEFAULT NULL,
  `current_val` text DEFAULT NULL,
  `inductor` text DEFAULT NULL,
  `product_name` varchar(255) DEFAULT NULL,
  `photo_url` text DEFAULT NULL,
  `datasheet_url` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sp_pcb_parts_doc_id` (`doc_id`),
  UNIQUE KEY `uk_sp_pcb_parts_servicetype_partname` (`service_type`(50),`part_name`(150)),
  KEY `idx_sp_pcb_parts_service_type` (`service_type`),
  KEY `idx_sp_pcb_parts_sub_service_type` (`sub_service_type`),
  KEY `idx_sp_pcb_parts_part_name` (`part_name`),
  KEY `idx_sp_pcb_parts_manufacturer` (`manufacturer_name`),
  KEY `idx_sp_pcb_parts_member_id` (`member_id`),
  KEY `idx_sp_pcb_parts_price` (`price`)
) ENGINE=MyISAM AUTO_INCREMENT=18254 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_pcb_parts_price =====
*************************** 1. row ***************************
sp_pcb_parts_price
CREATE TABLE `sp_pcb_parts_price` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `parts_id` bigint(20) NOT NULL,
  `distributor` varchar(255) DEFAULT NULL,
  `sku` varchar(255) DEFAULT NULL,
  `stock` int(11) NOT NULL DEFAULT 0,
  `moq` int(11) NOT NULL DEFAULT 0,
  `pkg` varchar(100) DEFAULT NULL,
  `updated_date` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sp_pcb_parts_price_parts_id` (`parts_id`),
  KEY `idx_sp_pcb_parts_price_distributor` (`distributor`)
) ENGINE=MyISAM AUTO_INCREMENT=27737 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_pcb_parts_price_step =====
*************************** 1. row ***************************
sp_pcb_parts_price_step
CREATE TABLE `sp_pcb_parts_price_step` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `price_id` bigint(20) NOT NULL,
  `break_quantity` int(11) NOT NULL DEFAULT 0,
  `unit_price` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_sp_pcb_parts_price_step_price_id` (`price_id`)
) ENGINE=MyISAM AUTO_INCREMENT=155324 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_bom_document =====
*************************** 1. row ***************************
sp_bom_document
CREATE TABLE `sp_bom_document` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `mb_id` varchar(100) NOT NULL COMMENT '회원 ID',
  `file_name` varchar(255) NOT NULL COMMENT '원본 파일명',
  `content_hash` varchar(64) DEFAULT NULL COMMENT 'SHA-256 해시',
  `file_info` text DEFAULT NULL COMMENT '업로드 파일 정보 JSON 문자열',
  `items` longtext NOT NULL COMMENT 'PcbItem[] JSON 문자열',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mb_content` (`mb_id`,`content_hash`),
  KEY `idx_mb_id` (`mb_id`)
) ENGINE=MyISAM AUTO_INCREMENT=279 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
-- ===== sp_file =====
*************************** 1. row ***************************
sp_file
CREATE TABLE `sp_file` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `ref_type` varchar(50) NOT NULL,
  `ref_id` bigint(20) NOT NULL,
  `upload_file_name` varchar(255) NOT NULL,
  `origin_file_name` varchar(255) NOT NULL,
  `path_token` varchar(500) NOT NULL,
  `size` bigint(20) NOT NULL DEFAULT 0,
  `write_date` datetime NOT NULL,
  `file_type` varchar(50) DEFAULT NULL,
  `uploaded_by` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sp_file_ref` (`ref_type`,`ref_id`)
) ENGINE=MyISAM AUTO_INCREMENT=233 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci
