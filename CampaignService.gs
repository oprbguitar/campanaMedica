function getActiveCampaigns() {
  return withPublicErrorHandling_(function () {
    const today = todayText_();
    const campaigns = readRows_(SHEET_NAMES_.CAMPAIGNS).rows
      .filter(function (campaign) {
        return isTrueValue_(campaign.activo) && (!campaign.fecha_fin || String(campaign.fecha_fin) >= today);
      })
      .map(function (campaign) {
        return {
          campaignId: campaign.campaign_id,
          name: campaign.nombre,
          description: campaign.descripcion,
          startDate: campaign.fecha_inicio,
          endDate: campaign.fecha_fin
        };
      });
    return { success: true, campaigns: campaigns };
  });
}

function getBookingCalendar() {
  return withPublicErrorHandling_(function () {
    const today = todayText_();
    const campaigns = readRows_(SHEET_NAMES_.CAMPAIGNS).rows
      .filter(function (campaign) {
        return isTrueValue_(campaign.activo) && (!campaign.fecha_fin || String(campaign.fecha_fin) >= today);
      });
    if (!campaigns.length) return { success: true, campaigns: [], campaignId: '', dates: [] };

    const campaign = campaigns[0];
    const campaignId = String(campaign.campaign_id);
    const dates = readRows_(SHEET_NAMES_.SLOTS).rows
      .filter(function (slot) {
        return String(slot.campaign_id) === campaignId && String(slot.fecha) >= today && isSlotAvailable_(slot);
      })
      .map(function (slot) { return String(slot.fecha); })
      .filter(function (date, index, array) { return array.indexOf(date) === index; })
      .sort();

    return {
      success: true,
      campaigns: campaigns.map(function (item) {
        return { campaignId: item.campaign_id, name: item.nombre, description: item.descripcion, startDate: item.fecha_inicio, endDate: item.fecha_fin };
      }),
      campaignId: campaignId,
      dates: dates
    };
  });
}

function getCampaignById_(campaignId) {
  return findRowByField_(SHEET_NAMES_.CAMPAIGNS, 'campaign_id', campaignId);
}

function requireActiveCampaign_(campaignId) {
  const campaign = getCampaignById_(campaignId);
  if (!campaign) throwAppError_('CAMPAIGN_NOT_FOUND', 'No existe la campaña.');
  if (!isTrueValue_(campaign.activo)) throwAppError_('CAMPAIGN_NOT_ACTIVE', 'La campaña no está activa.');
  if (campaign.fecha_fin && String(campaign.fecha_fin) < todayText_()) throwAppError_('CAMPAIGN_NOT_ACTIVE', 'La campaña ya terminó.');
  return campaign;
}

function getCampaignDates(campaignId) {
  return withPublicErrorHandling_(function () {
    const normalizedCampaignId = validateCampaignId_(campaignId);
    requireActiveCampaign_(normalizedCampaignId);
    const dates = readRows_(SHEET_NAMES_.SLOTS).rows
      .filter(function (slot) {
        return String(slot.campaign_id) === normalizedCampaignId && String(slot.fecha) >= todayText_() && isSlotAvailable_(slot);
      })
      .map(function (slot) { return String(slot.fecha); })
      .filter(function (date, index, array) { return array.indexOf(date) === index; })
      .sort();
    return { success: true, dates: dates };
  });
}
